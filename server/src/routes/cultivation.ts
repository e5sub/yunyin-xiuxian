/**
 * 服务端权威突破(1.57.0):掷点、渡劫推演、进境或赔偿,全部只在服务端结算。
 *
 * 为什么:此前突破全在客户端跑,console 改 store 能直接改境界;数值权威化(saveAuthority)
 * 只能在上传时事后钳。现在境界的唯一写入口是这个接口 —— 服务端从云档无头水合,
 * 跑客户端同一份裁决代码(core/breakthroughResolve),把改动的字段写回云档并落 profiles。
 * 客户端(登录态)只发请求,成败都按回传字段落账;上传存档里的 major/sub 从此不被采信。
 */
import express, { type Request, type Response } from 'express'
import { get, run, upsertByPk } from '../db.js'
import { requireAuth } from '../auth.js'
import { metricsOf, backupBeforeOverwrite, syncProfileFromData } from './save.js'

const CLIENT_MODULE: string = '../../../src/core/breakthroughResolve'

/** core/breakthroughResolve 的形状;动态 import 拿到的是 any,这里把字段兜死 */
interface ResolveResult {
  outcome: {
    ok: boolean
    reason: string
    success: boolean
    isMajor: boolean
    needTribulation: boolean
    tribulationLog: string[]
    fromMajor: number
    fromSub: number
    newMajor: number
    newSub: number
  }
  patches: Record<string, Record<string, unknown>>
  snapshot: Record<string, unknown> | null
}

type ResolveFn = (
  data: unknown,
  claims: { exp?: unknown; qi?: unknown },
  ctx: { elapsedSec: number }
) => ResolveResult | null

let cached: Promise<{ resolveBreakthroughFromSlices: ResolveFn }> | null = null

function clientResolve(): Promise<{ resolveBreakthroughFromSlices: ResolveFn }> {
  cached ??= import(CLIENT_MODULE)
  return cached
}

/** 同一账号两次尝试的最小间隔:掷点有成本,但仍防高频刷接口 */
const ATTEMPT_MIN_GAP_MS = 1_000
/** 每账号上次尝试时刻(内存即可:重启清零只放宽一次) */
const lastAttemptAt = new Map<number, number>()

function flagIndex(major: number, sub: number): number {
  return Math.max(0, Math.trunc(major)) * 100 + Math.max(0, Math.trunc(sub))
}

export const cultivationRouter = express.Router()

cultivationRouter.post('/cultivation/breakthrough', requireAuth, (req: Request, res: Response) => {
  void (async () => {
    const userId = req.user!.id
    const now = Date.now()
    const last = lastAttemptAt.get(userId) ?? 0
    if (now - last < ATTEMPT_MIN_GAP_MS) {
      res.status(429).json({ error: '操作太快,稍候再试' })
      return
    }
    lastAttemptAt.set(userId, now)

    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>
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
    const metrics = metricsOf(row.data)
    if (!metrics.started) {
      res.status(400).json({ error: '尚未开始修行' })
      return
    }

    // 无头结算:水合 → 收口上报修为/灵气 → 同一套裁决代码掷点 → 顶层键级 diff
    const mod = await clientResolve()
    const resolved = mod.resolveBreakthroughFromSlices(
      data,
      { exp: body.exp, qi: body.qi },
      { elapsedSec: Math.max(0, now - row.updated_at) / 1000 }
    )
    if (resolved === null) {
      res.status(500).json({ error: '突破结算失败' })
      return
    }
    const { outcome, patches, snapshot } = resolved
    if (!outcome.ok) {
      // 门槛不满足:突破未发生,一分未动
      res.json({ ok: false, reason: outcome.reason })
      return
    }

    // 变更字段并进云档(键序不动);updated_at 不动 —— 客户端锚点与冲突判定不受影响
    for (const [slice, fields] of Object.entries(patches)) {
      const cur = typeof data[slice] === 'object' && data[slice] !== null ? (data[slice] as Record<string, unknown>) : {}
      data[slice] = { ...cur, ...fields }
    }
    try {
      await backupBeforeOverwrite(userId, { version: row.version, data: row.data, updated_at: row.updated_at })
    } catch {
      // 留档失败不拦结算
    }
    await upsertByPk('saves', {
      user_id: userId,
      version: row.version,
      data: JSON.stringify(data),
      started: 1,
      updated_at: row.updated_at
    })
    // profiles 跟着结算结果走(复算快照;失败不动,下次上传按存档重算)
    try {
      await syncProfileFromData(userId, data, now)
    } catch {
      // 同上:失败不拦结算
    }
    // 留痕:成功才记(失败是常态,不刷屏),GM 后台「审计」列可见
    try {
      const detail = `${flagIndex(outcome.fromMajor, outcome.fromSub)}→${flagIndex(outcome.newMajor, outcome.newSub)}${
        outcome.needTribulation ? '(渡劫)' : ''
      }`
      await run(
        'INSERT INTO save_flags (user_id, name, kind, detail, realm_index, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [
          userId,
          typeof snapshot?.name === 'string' ? snapshot.name.slice(0, 64) : '',
          'breakthrough',
          detail.slice(0, 255),
          flagIndex(outcome.newMajor, outcome.newSub),
          now
        ]
      )
    } catch {
      // 留痕失败不影响结算
    }
    res.json({ ok: true, outcome, slices: patches })
  })().catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
})
