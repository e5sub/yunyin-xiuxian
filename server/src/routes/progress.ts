/**
 * 服务端权威升级(1.59.0):功法进修与洞府建筑升级,只在服务端结算。
 *
 * 为什么:炼器(1.58.3)与掉落(1.58.0)收进服务端后,「功法等级」与「建筑等级」
 * 仍能靠改档白拿 —— sanitize 只钳「结构上不可能」(≤ 满级),不问付没付;
 * 而这两样都是实打实的战力(功法 perLevelMods、建筑的强化上限/副修席位/离线时长)。
 * 现在这两件事的唯一写入口是 POST /api/progress/op:服务端从云档无头水合,
 * 跑客户端同一份纯账层(core/levelResolve:算价 → 验余额 → 扣款 → 升级),
 * 把改动的分片写回云档,并把价目记进 progress_spend 台账。
 *
 * 客户端(登录态)只发请求,结果以回传的 slices 为准;上传存档时悟道点/残页/玄铁/灵石
 * 的可增长量要按台账扣(见 server/src/routes/save.ts 与 core/saveAuthority 的 pendingSpend)——
 * 这样即便有人绕过接口直接改档也留不下来。
 */
import express, { type Request, type Response } from 'express'
import { get, run, upsertByPk } from '../db.js'
import { requireAuth } from '../auth.js'
import { metricsOf, backupBeforeOverwrite, syncProfileFromData } from './save.js'
import { loadClientModule } from '../clientVendor.js'
import { recordProgressSpend } from '../progressLedger.js'
import { recordLevelStates } from '../levelLedger.js'

const SOURCE_MODULE = '../../../src/core/levelResolve'
const VENDOR_FILE = 'levelResolve'

interface LevelResultDto {
  ok: boolean
  reason: string
  op: string
  slices: Record<string, Record<string, unknown>>
  spend: { stone: { m: number; e: number }; ore: number; wudao: number; page: number }
  detail: { kind: string; id: string; from: number; to: number; levels: number; atMax: boolean }
}

interface ClientLevelModule {
  resolveLevelFromSlices: (
    data: unknown,
    rawOp: unknown,
    claims: Record<string, unknown>
  ) => LevelResultDto | null
}

let cached: Promise<ClientLevelModule> | null = null

function clientLevel(): Promise<ClientLevelModule> {
  // 加载失败不缓存 rejected promise:vendor 缺失/损坏是部署事故,修好后不该重启进程才恢复(1.62.0)
  cached ??= loadClientModule<ClientLevelModule>(SOURCE_MODULE, VENDOR_FILE)
  cached.catch(() => {
    cached = null
  })
  return cached
}

/**
 * 同一账号两次升级的最小间隔。升级是单点动作(不像强化连点),价目已由服务端算,
 * 限速只为挡高频刷接口;比炼器(80ms)稍宽。
 */
const OP_MIN_GAP_MS = 150
const lastOpAt = new Map<number, number>()

/** 单账号留痕节流:同一秒同一动作只记一条 */
const lastFlagAt = new Map<string, number>()

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 把回传的变更分片原位合并回云档(顶层键级;没出现的键不动) */
function patchSlices(data: Record<string, unknown>, slices: Record<string, Record<string, unknown>>): void {
  for (const [name, slice] of Object.entries(slices)) {
    const cur = isPlainObject(data[name]) ? (data[name] as Record<string, unknown>) : null
    if (cur === null) continue
    data[name] = { ...cur, ...slice }
  }
}

export const progressRouter = express.Router()

progressRouter.post('/progress/op', requireAuth, (req: Request, res: Response) => {
  void (async () => {
    const userId = req.user!.id
    const now = Date.now()
    const last = lastOpAt.get(userId) ?? 0
    if (now - last < OP_MIN_GAP_MS) {
      res.status(429).json({ error: '操作太快,稍候再试' })
      return
    }
    lastOpAt.set(userId, now)

    const body = (isPlainObject(req.body) ? req.body : {}) as Record<string, unknown>
    const row = await get<{ version: number; data: string; updated_at: number }>(
      'SELECT version, data, updated_at FROM saves WHERE user_id = ?',
      [userId]
    )
    if (row === undefined) {
      res.status(400).json({ error: '云端还没有存档' })
      return
    }
    let data: Record<string, unknown>
    try {
      const parsed = JSON.parse(row.data) as unknown
      if (!isPlainObject(parsed)) throw new Error('bad')
      data = parsed
    } catch {
      res.status(400).json({ error: '云端存档不可读' })
      return
    }
    if (!metricsOf(row.data).started) {
      res.status(400).json({ error: '尚未开始修行' })
      return
    }

    const mod = await clientLevel()
    // 无头结算:水合 → 采信不低于云档的上报余额 → 同一套纯账层算价扣款 → 变更分片与应扣账
    const result = mod.resolveLevelFromSlices(
      data,
      body.op,
      { wudao: body.wudao, page: body.page, ore: body.ore, stone: body.stone }
    )
    if (result === null) {
      res.status(400).json({ error: '升级申请无效' })
      return
    }
    // 被拒(满级/缺料/境界闸/辖限):一级未升、一笔未扣,只把原因回给客户端出提示
    if (!result.ok) {
      res.json({ ok: false, reason: result.reason, op: result.op })
      return
    }

    patchSlices(data, result.slices)
    try {
      await backupBeforeOverwrite(userId, { version: row.version, data: row.data, updated_at: row.updated_at })
    } catch {
      // 留档失败不拦结算
    }
    // updated_at 不动:客户端锚点与冲突判定不受影响(与突破/炼器结算同规)
    await upsertByPk('saves', {
      user_id: userId,
      version: row.version,
      data: JSON.stringify(data),
      started: 1,
      updated_at: row.updated_at
    })
    // 支出记账:上传存档时从资源增量里扣(扣款本身写在客户端)
    try {
      await recordProgressSpend(userId, {
        stone: { m: result.spend.stone.m, e: result.spend.stone.e },
        ore: result.spend.ore,
        wudao: result.spend.wudao,
        page: result.spend.page
      })
    } catch {
      /* 记不上只是这一次不扣,不影响本次结算 */
    }
    // 等级入账(1.59.1):新等级进了台账,上传存档时才能按台账压回直注的等级
    try {
      await recordLevelStates(userId, [
        {
          kind: result.detail.kind === 'gongfa' ? ('gongfa' as const) : ('building' as const),
          itemId: result.detail.id,
          level: result.detail.to
        }
      ])
    } catch {
      /* 记不上只是这条压不住,下次签发再补;不影响本次结算 */
    }
    // 战力变了,概要跟着走(建筑与功法都进属性)
    try {
      await syncProfileFromData(userId, data, now)
    } catch {
      /* 失败不动:下次上传按存档重算 */
    }
    // 留痕:同一账号同一动作一秒一条,防连点刷屏
    try {
      const key = `${userId}:${result.op}`
      if (now - (lastFlagAt.get(key) ?? 0) > 1_000) {
        lastFlagAt.set(key, now)
        const d = result.detail
        await run(
          'INSERT INTO save_flags (user_id, name, kind, detail, realm_index, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          [userId, '', 'level', `${result.op} ${d.id} ${d.from}->${d.to}(${d.levels})`.slice(0, 255), 0, now]
        )
      }
    } catch {
      /* 留痕失败不影响结算 */
    }
    res.json({ ok: true, op: result.op, slices: result.slices, spend: result.spend, detail: result.detail })
  })().catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
})
