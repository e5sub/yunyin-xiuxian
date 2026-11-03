/** 云存档 + 玩家档案快照 + 存档历史(防丢/可回滚) */
import express, { type Request, type Response } from 'express'
import { all, get, run, upsertByPk } from '../db.js'
import { requireAuth } from '../auth.js'
import { getConfigNumber } from '../config.js'
import { recomputeProfile } from '../recompute.js'
import { normalizeSaveSlices } from '../saveNormalize.js'
import { enforceAuthority } from '../saveAuthority.js'

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

/** 每账号留痕条数上限与抽稀间隔:自动上传最快 3 秒一推,不留抽稀会把表刷爆 */
const FLAG_KEEP = 20
const FLAG_MIN_GAP_MS = 10 * 60_000
/** 单次上传内境界跳这么多(一个大境界)就留痕:合法玩家升级是渐进的,GM 据此复核 */
const REALM_JUMP_FLAG = 100

/** 上次留痕时刻(内存即可:重启清零只会多留一条) */
const lastFlagAt = new Map<number, number>()

/**
 * 存档审计留痕 —— 只记不改,不拦存档。
 * 归一化修掉了什么、数值权威化压回了什么、境界有没有单次跳变,都写进 save_flags 供 GM 判定;
 * 真的在被改包的号,属性复算会把它压回真实曲线,但「谁在改」只有这里看得出来。
 */
async function auditSave(
  userId: number,
  name: string,
  realmIndex: number,
  prevRealmIndex: number,
  touched: readonly string[],
  authorityNotes: readonly string[] = []
): Promise<void> {
  const flags: Array<{ kind: string; detail: string }> = []
  if (touched.length > 0) flags.push({ kind: 'sanitized', detail: touched.join(',') })
  if (authorityNotes.length > 0) flags.push({ kind: 'authority', detail: authorityNotes.join(' | ') })
  const jump = realmIndex - prevRealmIndex
  if (prevRealmIndex > 0 && jump >= REALM_JUMP_FLAG) {
    flags.push({ kind: 'realm_jump', detail: `${prevRealmIndex}→${realmIndex}` })
  }
  if (flags.length === 0) return
  const now = Date.now()
  if (now - (lastFlagAt.get(userId) ?? 0) < FLAG_MIN_GAP_MS) return
  lastFlagAt.set(userId, now)
  for (const f of flags) {
    await run(
      'INSERT INTO save_flags (user_id, name, kind, detail, realm_index, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, name.slice(0, 64), f.kind, f.detail.slice(0, 255), realmIndex, now]
    )
  }
  await run(
    'DELETE FROM save_flags WHERE user_id = ? AND id NOT IN (SELECT id FROM (SELECT id FROM save_flags WHERE user_id = ? ORDER BY id DESC LIMIT ?) t)',
    [userId, userId, FLAG_KEEP]
  )
}

/** 属性快照钳制上限:尾数与十进制指数都远超正常玩法上限(中文单位到「极」≈e48,真仙终局 ≈e80)。
 *  上限要压得足够低才有意义 —— 钳到 e500 等于没钳:改包写 e300 照样秒杀一切服务端玩法、
 *  还能把妖王血量抬到全服打不动。e150 仍比合法天花板高出 70 个数量级,正常玩家碰不到。 */
const SNAP_MANTISSA_MAX = 1e6
const SNAP_EXP_MAX = 150
/** 合法境界上限:5 界 29 境 → major×100+sub 最高 2809;留到 3000,改包写 20000 会把副本/妖王的境界基准拉爆 */
const REALM_INDEX_MAX = 3_000
/** 快照境界与存档境界允许的偏差:快照与存档同刻生成,差超过一个大境界即视为被改 */
const REALM_SNAP_TOLERANCE = 200

/** 每账号上次写档时刻(内存即可:重启清零只影响 2 秒窗口) */
const lastWriteAt = new Map<number, number>()

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/**
 * 快照校验:字段缺失或非法按 0 兜底;name/realmLabel 兜空串。
 * 只做解析,不钳制 —— 钳制统一走 clampSnapshot(复算结果与客户端快照同一把尺)。
 */
function parseSnapshot(raw: unknown, userId: number): ProfileSnapshot | null {
  if (typeof raw !== 'object' || raw === null) return null
  const b = raw as Record<string, unknown>
  const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '')
  const num = (v: unknown): number => (finite(v) ? v : 0)
  const int = (v: unknown): number => (finite(v) ? Math.trunc(v) : 0)
  return {
    name: str(b.name, 24) || `道友${userId}`,
    realmLabel: str(b.realmLabel, 24),
    realmIndex: int(b.realmIndex),
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
 * 快照钳制(复算与客户端快照共用):
 *  - 指数/尾数压到合法玩法上限之外一点点(中文单位到「极」≈e48,真仙终局 ≈e80;e150 高出 70 个数量级,
 *    正常玩家碰不到 —— 改包写 e300 也到此为止,围妖/副本/擂台与妖王血量不再被天文数字污染);
 *  - 境界钳到合法上限(5 界 29 境 → 2809,留 3000);
 *  - 快照境界与存档境界(major×100+sub,同刻生成)偏差超过一个大境界即按存档收口 ——
 *    拦「低境界高攻」的快照单改(console 改 Pinia 后自动上传)。
 */
function clampSnapshot(s: ProfileSnapshot, saveRealmIndex: number, userId: number): ProfileSnapshot {
  const num = (v: number): number => Math.min(Math.max(v, 0), SNAP_MANTISSA_MAX)
  const int = (v: number): number => Math.trunc(Math.min(Math.max(v, 0), SNAP_EXP_MAX))
  const realmCeil = Math.min(saveRealmIndex + REALM_SNAP_TOLERANCE, REALM_INDEX_MAX)
  return {
    name: s.name.trim().slice(0, 24) || `道友${userId}`,
    realmLabel: s.realmLabel.slice(0, 24),
    realmIndex: Math.min(Math.max(s.realmIndex, 0), Math.max(realmCeil, 0)),
    powerM: num(s.powerM),
    powerE: int(s.powerE),
    hpM: num(s.hpM),
    hpE: int(s.hpE),
    atkM: num(s.atkM),
    atkE: int(s.atkE),
    defM: num(s.defM),
    defE: int(s.defE)
  }
}

async function upsertProfile(userId: number, s: ProfileSnapshot, now: number): Promise<void> {
  await upsertByPk('profiles', {
    user_id: userId,
    name: s.name,
    realm_label: s.realmLabel,
    realm_index: s.realmIndex,
    power_m: s.powerM,
    power_e: s.powerE,
    hp_m: s.hpM,
    hp_e: s.hpE,
    atk_m: s.atkM,
    atk_e: s.atkE,
    def_m: s.defM,
    def_e: s.defE,
    updated_at: now
  })
}

/** 复算结果字段完整性:动态模块在服务端是 any,进库前把形态兜死 */
function snapshotComplete(s: Record<string, unknown> | null): s is ProfileSnapshot & Record<string, unknown> {
  if (s === null) return false
  const keys = ['realmIndex', 'powerM', 'powerE', 'hpM', 'hpE', 'atkM', 'atkE', 'defM', 'defE'] as const
  if (!keys.every(k => finite(s[k]))) return false
  return typeof s.name === 'string' && typeof s.realmLabel === 'string'
}

/**
 * 按存档内容同步档案快照(复算优先,失败不动 profiles)。
 * 供存档被服务端单方面改写的地方共用:突破结算、回档 —— 这些场景 profiles 必须跟着存档走,
 * 否则权威化会把客户端境界压回旧值,回档等于没回、突破等于白突。
 */
export async function syncProfileFromData(userId: number, data: unknown, now: number): Promise<void> {
  const recomputed = await recomputeProfile(data)
  if (!snapshotComplete(recomputed)) return
  const realmIndex = finite(recomputed.realmIndex) ? Math.trunc(recomputed.realmIndex) : 0
  await upsertProfile(userId, clampSnapshot(recomputed, realmIndex, userId), now)
}

/**
 * 从存档 JSON 里取判定用的两个指标。
 * 服务端只做「是否已开局 / 境界高低」的比较,不解析其余内容(玩法字段归客户端)。
 */
export function metricsOf(json: string): { started: boolean; realmIndex: number } {
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
export async function backupBeforeOverwrite(userId: number, old: { version: number; data: string; updated_at: number }): Promise<void> {
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
    /*
     * 落库前归一化:野装备 id、超品阶、超词条数、超强化等级、超满级功法、坏大数指数、
     * 境界越界 —— 全部按客户端读档自愈的同一套判据修平再进库。
     * 归一化失败(模块加载不了/分片畸形到链路抛错)按原样落库:加固环节不能变成拒收存档。
     */
    const normalized = await normalizeSaveSlices(body.data)
    const normalizedData = (normalized === null ? body.data : normalized.data) as Record<string, unknown>

    const old = await get<{ version: number; data: string; updated_at: number }>(
      'SELECT version, data, updated_at FROM saves WHERE user_id = ?',
      [req.user!.id]
    )
    /*
     * 数值权威化:客户端上报的数值只是「提议」,落库的是服务端裁决后的结果。
     * 依次裁「境界 → 修为 → 资源 → 装备」,判据全部取自游戏自己的模型
     * (突破需求 / 每秒产速 / 每境界每小时产出 / 境界解锁层级),见 src/core/saveAuthority.ts。
     *
     * 境界基线取 profiles.realm_index 而不是上次存档:玩家删档重传时 saves 会消失,
     * profiles 不受影响 —— 否则「删档 + 重传高境界档」就是一条绕过路径。
     */
    const prevProfileRow = await get<{ realm_index: number }>('SELECT realm_index FROM profiles WHERE user_id = ?', [
      req.user!.id
    ])
    let prevData: Record<string, unknown> | null = null
    if (old !== undefined) {
      try {
        const parsed = JSON.parse(old.data) as unknown
        prevData = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null
      } catch {
        prevData = null
      }
    }
    const authority = await enforceAuthority({
      prev: prevData,
      next: normalizedData,
      prevRealmIndex: prevProfileRow?.realm_index ?? 0,
      elapsedMs: old === undefined ? 0 : Math.max(0, now - old.updated_at),
      // 1.57.0+ 客户端标记:境界只认 profiles(唯一写入口是突破 API),上传里的 major/sub 不采信。
      // 老客户端不带标记,沿用「付得起」预算判据 —— 存量客户端与自建部署的兼容口。
      realmAuthoritative: body.realmAuth === 2
    })
    const data = authority === null ? normalizedData : authority.data
    let json: string
    try {
      json = JSON.stringify(data)
    } catch {
      res.status(400).json({ error: '存档不可序列化' })
      return
    }
    if (json.length > 8 * 1024 * 1024) {
      res.status(413).json({ error: '存档过大' })
      return
    }

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
    // 快照以复算为准:用上传分片无头水合同一批 store、跑同一份 finalStats 链重算;
    // 复算失败(分片畸形/链路抛错)才回落客户端快照;两边都拿不到(老客户端不带 profile)就不动 profiles。
    // 用归一化后的 data 复算,与落库内容同源。两条路最后都过同一把钳制尺。
    const clientSnap = parseSnapshot(body.profile, req.user!.id)
    const recomputed = await recomputeProfile(data)
    if (snapshotComplete(recomputed)) {
      await upsertProfile(req.user!.id, clampSnapshot(recomputed, metrics.realmIndex, req.user!.id), now)
    } else if (clientSnap !== null) {
      await upsertProfile(req.user!.id, clampSnapshot(clientSnap, metrics.realmIndex, req.user!.id), now)
    }
    const displayName = typeof recomputed?.name === 'string' ? recomputed.name : (clientSnap?.name ?? '')
    try {
      await auditSave(
        req.user!.id,
        displayName,
        metrics.realmIndex,
        prevProfileRow?.realm_index ?? 0,
        normalized?.touched ?? [],
        authority?.notes ?? []
      )
    } catch {
      // 留痕失败不影响存档本身
    }
    // corrections 回给客户端:被压回的字段要立刻以服务端值覆盖本地,否则玩家看到的是作弊值
    res.json({ ok: true, updatedAt: now, corrections: authority?.corrections ?? [] })
  })().catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
})

saveRouter.delete('/save', requireAuth, (req: Request, res: Response) => {
  void (async () => {
    await run('DELETE FROM saves WHERE user_id = ?', [req.user!.id])
    // 境界基线一并归零:删档重修是合法路径,基线不归零,权威化会把新档的境界强行顶回旧值
    await run("UPDATE profiles SET realm_index = 0, realm_label = '' WHERE user_id = ?", [req.user!.id])
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
    // 境界基线跟着回档走:不同步的话,权威化会把客户端境界压回回档前的旧值,回档等于没回
    try {
      await syncProfileFromData(req.user!.id, JSON.parse(row.data), now)
    } catch {
      // 快照复算失败时 profiles 不动:下一次上传仍会按存档内容重算
    }
    res.json({ ok: true, updatedAt: now })
  })().catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
})
