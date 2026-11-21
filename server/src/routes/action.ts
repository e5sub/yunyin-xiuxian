/**
 * 动作结算端点(1.78.0):玩家「点一下」产生的进度由服务端执行。
 *
 * 与 PUT /save 的分工:
 *   - 本端点**执行**动作(吃丹、炼丹、际遇、秘境、熔炉、分解、卖出、兑换、装配…),
 *     在云档上跑客户端同一份结算代码(core/actionOps,经 vendor 加载),把改动的分片
 *     键级 diff 回传;云档同步更新。
 *   - PUT /save 此后只同步 UI 偏好类字段(见 routes/save 的权威字段表),
 *     数值一律以云档为准 —— 客户端上传的数字不再影响进度。
 *
 * 与 /game/advance 共用 `save:<uid>` 锁:两者都是「读整档 → 结算 → 写回」。
 * updated_at 随每次落档推进:它是 advance 重启后的时间锚点兜底,停在旧值会重复结算一段。
 */
import express, { type Request, type Response } from 'express'
import { get, run, upsertByPk } from '../db.js'
import { requireAuth } from '../auth.js'
import { metricsOf, syncProfileFromData } from './save.js'
import { loadClientModule } from '../clientVendor.js'
import { withKeyLock } from '../mutex.js'
import { heldKeys, reconcileHeldLoot, syncNewLoot } from '../lootSync.js'

const SOURCE_MODULE = '../../../src/core/actionOps'
const VENDOR_FILE = 'actionOps'

interface ActionResultShape {
  ok: boolean
  reason?: string
  patches: Record<string, Record<string, unknown>>
  payload?: unknown
}

type ResolveFn = (
  data: unknown,
  req: Record<string, unknown>,
  ctx: { now: number }
) => Promise<ActionResultShape | null>

let cached: Promise<{ resolveActionFromSlices: ResolveFn }> | null = null

function clientResolve(): Promise<{ resolveActionFromSlices: ResolveFn }> {
  // 加载失败不缓存 rejected promise:vendor 缺失是部署事故,修好后不该重启才恢复
  cached ??= loadClientModule<{ resolveActionFromSlices: ResolveFn }>(SOURCE_MODULE, VENDOR_FILE)
  cached.catch(() => {
    cached = null
  })
  return cached
}

/** 同一账号两次动作的最小间隔:动作有签发成本,挡连点刷接口;正常点击远慢于此 */
const ACTION_MIN_GAP_MS = 250
const lastGateAt = new Map<number, number>()
const UID_MAP_SWEEP = 50_000

function sweepUidMap(m: Map<number, number>, now: number): void {
  if (m.size <= UID_MAP_SWEEP) return
  for (const [uid, at] of m) {
    if (now - at > 30 * 86_400_000) m.delete(uid)
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function sliceOf(data: Record<string, unknown>, id: string): Record<string, unknown> {
  return isPlainObject(data[id]) ? (data[id] as Record<string, unknown>) : {}
}

export const actionRouter = express.Router()

actionRouter.post('/action', requireAuth, (req: Request, res: Response) => {
  // 限速留在锁外、闸门时刻即落戳:排队的第二发不该因为「已等了一会儿」被放行
  const gateAt = Date.now()
  if (gateAt - (lastGateAt.get(req.user!.id) ?? 0) < ACTION_MIN_GAP_MS) {
    res.status(429).json({ error: '操作太快,稍候再试' })
    return
  }
  lastGateAt.set(req.user!.id, gateAt)
  sweepUidMap(lastGateAt, gateAt)

  void withKeyLock(`save:${req.user!.id}`, async () => {
    const userId = req.user!.id
    const now = Date.now()
    const body = isPlainObject(req.body) ? req.body : {}
    if (typeof body.kind !== 'string' || body.kind === '') {
      res.status(400).json({ error: '缺少动作类别' })
      return
    }
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
      data = JSON.parse(row.data) as Record<string, unknown>
    } catch {
      res.status(400).json({ error: '云端存档不可读' })
      return
    }
    if (!metricsOf(row.data).started) {
      res.status(400).json({ error: '尚未开始修行' })
      return
    }

    const mod = await clientResolve()
    const resolved = await mod.resolveActionFromSlices(data, body, { now })
    if (resolved === null) {
      res.status(500).json({ error: '动作结算失败' })
      return
    }
    // 动作本身失败(资源不够/境界不够):不回补丁,客户端据 ok=false 作废本地那次预测
    if (!resolved.ok) {
      res.json({ ok: false, reason: resolved.reason ?? '无法执行', slices: {} })
      return
    }

    const beforeKeys = heldKeys(data)
    const patches = resolved.patches
    for (const [slice, fields] of Object.entries(patches)) {
      data[slice] = { ...sliceOf(data, slice), ...fields }
    }

    /*
     * 台账补记:本动作签发的装备/法宝入账。记账失败整体作废(不回包、不落库),
     * 客户端留在本地预测里,下一次重试 —— 不带无账之件出闸。
     */
    try {
      await syncNewLoot(userId, data, beforeKeys, `action:${body.kind}`)
      // 离手的件同步清账,免得「按账补册」把已卖/已分解的旧件复活(1.79.5)
      await reconcileHeldLoot(userId, data)
    } catch {
      res.status(500).json({ error: '签发记账失败,请重试' })
      return
    }

    /*
     * 差事收割的收尾(1.79.0):产出的账已在云档里结过,这里的在途表要把那一行删掉 ——
     * 否则 `/apprentice/task/list` 会把它当成「服务端代派、本地还没收」的单再对齐回来,
     * 同一趟差事就能反复收。删在落档之后、失败不影响已结的账(下一次 claim 会得到 gone)。
     */
    if (body.kind === 'apprentice_claim' && typeof body.id === 'string' && body.id !== '') {
      try {
        await run('DELETE FROM apprentice_tasks WHERE user_id = ? AND uid = ?', [userId, body.id.slice(0, 64)])
      } catch {
        // 表不在/锁冲突都不该让这次收割失败:产出已经在云档里了
      }
    }

    if (Object.keys(patches).length > 0) {
      await upsertByPk('saves', {
        user_id: userId,
        version: row.version,
        data: JSON.stringify(data),
        started: 1,
        // 必须推进:服务端重启后 advance 拿 saves.updated_at 当时间锚点兜底,
        // 停在首传那一刻会把「重启前那一段」当离线收益重算一遍(1.78.0)
        updated_at: now
      })
      try {
        await syncProfileFromData(userId, data, now)
      } catch {
        // 快照复算失败不拦动作:下一次上传/心跳会按存档重算
      }
    }

    res.json({ ok: true, slices: patches, payload: resolved.payload ?? null })
  }).catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
})

/**
 * 本地预测作废后的重对齐:把云档的完整分片交回客户端覆盖本地。
 * 只在动作被服务端拒绝时用(低频),不在每次动作都拉整档。
 */
actionRouter.get('/action/resync', requireAuth, (req: Request, res: Response) => {
  void (async () => {
    const row = await get<{ data: string }>('SELECT data FROM saves WHERE user_id = ?', [req.user!.id])
    if (row === undefined) {
      res.json({ ok: true, slices: null })
      return
    }
    try {
      const data = JSON.parse(row.data) as Record<string, unknown>
      res.json({ ok: true, slices: data })
    } catch {
      res.status(500).json({ error: '云端存档不可读' })
    }
  })().catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
})
