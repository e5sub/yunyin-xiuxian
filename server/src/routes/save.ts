/** 云存档 + 玩家档案快照 + 存档历史(防丢/可回滚) */
import express, { type Request, type Response } from 'express'
import { all, get, run, upsertByPk } from '../db.js'
import { requireAuth } from '../auth.js'
import { getConfigNumber } from '../config.js'

export interface ProfileSnapshot {
  name: string
  realmLabel: string
  realmIndex: number
  powerM: number
  powerE: number
  hpM: number
  hpE: number
  atkM: number
  atkE: number
  defM: number
  defE: number
}

/** 每用户保留的历史份数上限(钳制用;实际份数走 GM 后台 save_history_keep,默认 3) */
const HISTORY_KEEP_MAX = 96
/** 两次留存的最小间隔:客户端 20 秒推一次,不抽稀会一天灌满几千份 */
const HISTORY_MIN_GAP_MS = 10 * 60_000
/** 历史留存上限(天) */
const HISTORY_TTL_MS = 7 * 24 * 3_600_000
/** 客户端回传的 baseUpdatedAt 与服务端值的容差:上一次写入成功但响应丢了不算冲突 */
const CONFLICT_TOLERANCE_MS = 2_000
/** 同一账号两次写档的最小间隔:客户端自动上传最快 3 秒一推,限速防改包刷写档接口 */
const WRITE_MIN_GAP_MS = 2_000

/** 留档份数上限:GM 后台 save_history_keep 可调,钳 1~96(云存档空间按人头封顶) */
async function historyKeep(): Promise<number> {
  const n = await getConfigNumber('save_history_keep', 3)
  return Math.min(Math.max(Math.trunc(n), 1), HISTORY_KEEP_MAX)
}

/** 属性快照钳制上限:尾数与十进制指数都远超正常玩法上限(中文单位到「极」≈e48,真仙终局 ≈e80) */
const SNAP_MANTISSA_MAX = 1e6
const SNAP_EXP_MAX = 500
const REALM_INDEX_MAX = 20_000

/** 每账号上次写档时刻(内存即可:重启清零只影响 2 秒窗口) */
const lastWriteAt = new Map<number, number>()

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/**
 * 快照校验:字段缺失或非法按 0 兜底;name/realmLabel 兜空串。
 * 属性按上限钳制:改包客户端上传 1e999 级攻击力,战斗结算与排行榜也不会被其污染。
 */
function parseSnapshot(raw: unknown, userId: number): ProfileSnapshot | null {
  if (typeof raw !== 'object' || raw === null) return null
  const b = raw as Record<string, unknown>
  const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '')
  const num = (v: unknown): number => (finite(v) ? Math.min(Math.max(v, 0), SNAP_MANTISSA_MAX) : 0)
  const int = (v: unknown): number => (finite(v) ? Math.trunc(Math.min(Math.max(v, 0), SNAP_EXP_MAX)) : 0)
  const realm = (v: unknown): number => (finite(v) ? Math.trunc(Math.min(Math.max(v, 0), REALM_INDEX_MAX)) : 0)
  return {
    name: str(b.name, 24) || `道友${userId}`,
    realmLabel: str(b.realmLabel, 24),
    realmIndex: realm(b.realmIndex),
    powerM: num(b.powerM),
    powerE: int(b.powerE),
    hpM: num(b.hpM),
    hpE: int(b.hpE),
    atkM: num(b.atkM),
    atkE: int(b.atkE),
    defM: num(b.defM),
    defE: int(b.defE)
  }
}

/**
 * 从存档 JSON 里取判定用的两个指标。
 * 服务端只做「是否已开局 / 境界高低」的比较,不解析其余内容(玩法字段归客户端)。
 */
function metricsOf(json: string): { started: boolean; realmIndex: number } {
  try {
    const data = JSON.parse(json) as Record<string, unknown>
    const game = typeof data.game === 'object' && data.game !== null ? (data.game as Record<string, unknown>) : {}
    const player = typeof data.player === 'object' && data.player !== null ? (data.player as Record<string, unknown>) : {}
    const major = finite(player.major) ? Math.trunc(player.major) : 0
    const sub = finite(player.sub) ? Math.trunc(player.sub) : 0
    return { started: game.started === true, realmIndex: major * 100 + sub }
  } catch {
    return { started: false, realmIndex: 0 }
  }
}

/** 覆盖前留一份旧档:同份不重存、按间隔抽稀、突破(境界提升)必存,并顺手清理超量/超期 */
async function backupBeforeOverwrite(userId: number, old: { version: number; data: string; updated_at: number }): Promise<void> {
  const now = Date.now()
  const oldMetrics = metricsOf(old.data)
  const last = await get<{ id: number; updated_at: number; realm_index: number; created_at: number }>(
    'SELECT id, updated_at, realm_index, created_at FROM save_history WHERE user_id = ? ORDER BY id DESC LIMIT 1',
    [userId]
  )
  const sameAsLast = last !== undefined && last.updated_at === old.updated_at
  const reachedBreakthrough = last !== undefined && oldMetrics.realmIndex > last.realm_index
  const dueByGap = last === undefined || now - last.created_at >= HISTORY_MIN_GAP_MS
  if (!sameAsLast && (reachedBreakthrough || dueByGap)) {
    await run(
      'INSERT INTO save_history (user_id, version, data, realm_index, size, updated_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [userId, old.version, old.data, oldMetrics.realmIndex, old.data.length, old.updated_at, now]
    )
  }
  // 超量清理:留最近 N 份(GM 后台 save_history_keep,默认 3)
  const keep = await historyKeep()
  const count = await get<{ c: number }>('SELECT COUNT(*) AS c FROM save_history WHERE user_id = ?', [userId])
  if (count !== undefined && count.c > keep) {
    await run(
      'DELETE FROM save_history WHERE user_id = ? AND id NOT IN (SELECT id FROM (SELECT id FROM save_history WHERE user_id = ? ORDER BY id DESC LIMIT ?) t)',
      [userId, userId, keep]
    )
  }
  // 超期清理
  await run('DELETE FROM save_history WHERE user_id = ? AND created_at < ?', [userId, now - HISTORY_TTL_MS])
}

export const saveRouter = express.Router()

saveRouter.get('/save', requireAuth, (req: Request, res: Response) => {
  void (async () => {
    const row = await get<{ version: number; data: string; updated_at: number }>(
      'SELECT version, data, updated_at FROM saves WHERE user_id = ?',
      [req.user!.id]
    )
    if (row === undefined) {
      res.json({ save: null })
      return
    }
    res.json({ save: { version: row.version, data: JSON.parse(row.data), updatedAt: row.updated_at } })
  })().catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
})

saveRouter.put('/save', requireAuth, (req: Request, res: Response) => {
  void (async () => {
    // 写档限速:与上一写隔太近直接 429(无论成败都计时,防 409/校验失败风暴打库)
    const now0 = Date.now()
    const last = lastWriteAt.get(req.user!.id) ?? 0
    if (now0 - last < WRITE_MIN_GAP_MS) {
      res.status(429).json({ error: '存档保存太快,稍候再试' })
      return
    }
    lastWriteAt.set(req.user!.id, now0)

    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>
    const version = finite(body.version) ? Math.trunc(body.version) : 0
    if (version < 1 || version > 10_000) {
      res.status(400).json({ error: '存档版本无效' })
      return
    }
    if (typeof body.data !== 'object' || body.data === null) {
      res.status(400).json({ error: '存档数据缺失' })
      return
    }
    const now = Date.now()
    let json: string
    try {
      json = JSON.stringify(body.data)
    } catch {
      res.status(400).json({ error: '存档不可序列化' })
      return
    }
    if (json.length > 8 * 1024 * 1024) {
      res.status(413).json({ error: '存档过大' })
      return
    }

    const old = await get<{ version: number; data: string; updated_at: number }>(
      'SELECT version, data, updated_at FROM saves WHERE user_id = ?',
      [req.user!.id]
    )

    const metrics = metricsOf(json)
    if (old !== undefined) {
      const existing = metricsOf(old.data)
      // 保护一:云端已有进度,不许被「未开局」的档覆盖(新设备残档 / 清档后的空档)
      if (existing.started && !metrics.started) {
        res.status(409).json({
          code: 'empty_overwrite',
          error: '云端已有存档,拒绝用未开局的空档覆盖',
          updatedAt: old.updated_at
        })
        return
      }
      // 保护二:客户端声明了它基于哪个版本,与服务端不一致说明别的设备写过
      if (finite(body.baseUpdatedAt) && old.updated_at > body.baseUpdatedAt + CONFLICT_TOLERANCE_MS) {
        res.status(409).json({
          code: 'conflict',
          error: '云端存档已被其他设备更新',
          updatedAt: old.updated_at
        })
        return
      }
      await backupBeforeOverwrite(req.user!.id, old)
    }

    await upsertByPk('saves', {
      user_id: req.user!.id,
      version,
      data: json,
      started: metrics.started ? 1 : 0,
      updated_at: now
    })
    const snapshot = parseSnapshot(body.profile, req.user!.id)
    if (snapshot !== null) {
      await upsertByPk('profiles', {
        user_id: req.user!.id,
        name: snapshot.name,
        realm_label: snapshot.realmLabel,
        realm_index: snapshot.realmIndex,
        power_m: snapshot.powerM,
        power_e: snapshot.powerE,
        hp_m: snapshot.hpM,
        hp_e: snapshot.hpE,
        atk_m: snapshot.atkM,
        atk_e: snapshot.atkE,
        def_m: snapshot.defM,
        def_e: snapshot.defE,
        updated_at: now
      })
    }
    res.json({ ok: true, updatedAt: now })
  })().catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
})

saveRouter.delete('/save', requireAuth, (req: Request, res: Response) => {
  void (async () => {
    await run('DELETE FROM saves WHERE user_id = ?', [req.user!.id])
    res.json({ ok: true })
  })().catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
})

/** 自己的存档历史(不含 data,列表页够用) */
saveRouter.get('/save/history', requireAuth, (req: Request, res: Response) => {
  void (async () => {
    const limit = Math.min(Math.max(Number(req.query.limit ?? 30) || 30, 1), 96)
    const rows = await all<{ id: number; version: number; realm_index: number; size: number; updated_at: number; created_at: number }>(
      'SELECT id, version, realm_index, size, updated_at, created_at FROM save_history WHERE user_id = ? ORDER BY id DESC LIMIT ?',
      [req.user!.id, limit]
    )
    res.json({ history: rows })
  })().catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
})

/** 回滚到某个历史版本:当前档先存进历史,再写回 */
saveRouter.post('/save/restore', requireAuth, (req: Request, res: Response) => {
  void (async () => {
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>
    const historyId = finite(body.historyId) ? Math.trunc(body.historyId) : 0
    if (historyId <= 0) {
      res.status(400).json({ error: '缺少历史版本编号' })
      return
    }
    const row = await get<{ version: number; data: string; updated_at: number }>(
      'SELECT version, data, updated_at FROM save_history WHERE id = ? AND user_id = ?',
      [historyId, req.user!.id]
    )
    if (row === undefined) {
      res.status(404).json({ error: '历史版本不存在' })
      return
    }
    const current = await get<{ version: number; data: string; updated_at: number }>(
      'SELECT version, data, updated_at FROM saves WHERE user_id = ?',
      [req.user!.id]
    )
    if (current !== undefined) await backupBeforeOverwrite(req.user!.id, current)
    const now = Date.now()
    await upsertByPk('saves', {
      user_id: req.user!.id,
      version: row.version,
      data: row.data,
      started: metricsOf(row.data).started ? 1 : 0,
      updated_at: now
    })
    res.json({ ok: true, updatedAt: now })
  })().catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
})
