/**
 * 服务端权威推进(1.75.0):心跳产出、历练战斗与离线结算的唯一写入口。
 *
 * 为什么:此前这三样全在客户端算,服务端只在上传时事后钳(saveAuthority);
 * 改包抬高产速或把 lastActiveAt 拨回去,上传窗口内无人拦。现在登录态客户端
 * 定期发心跳:服务端按**自己的时间锚点**(内存 map,重启兜底用 saves.updated_at)
 * 无头水合云档,跑客户端同一份推进代码(core/advanceResolve),把改动的分片
 * 键级 diff 回传。客户端本地推演只作显示预测,不再权威。
 *
 * 与 PUT /save 共用 `save:<uid>` 锁(读整档 → 打补丁 → 整档写回,交错会互相顶掉)。
 * updated_at 随每次推进前进:它是重启后 dt 的兜底锚点(1.78.0 起客户端不再用它判冲突)。
 *
 * 台账:推进内签发的装备/法宝在回传前补进 loot_ledger 与装备状态台账 ——
 * 服务端自己发的件自己记账,上传验源才不会把它们当无主之件移除。
 */
import express, { type Request, type Response } from 'express'
import { get, run, upsertByPk } from '../db.js'
import { requireAuth } from '../auth.js'
import { metricsOf, syncProfileFromData } from './save.js'
import { loadClientModule } from '../clientVendor.js'
import { withKeyLock } from '../mutex.js'
import { heldKeys, syncNewLoot } from '../lootSync.js'

const SOURCE_MODULE = '../../../src/core/advanceResolve'
const VENDOR_FILE = 'advanceResolve'

/** OFFLINE_MIN_SECONDS(data/constants)的同值镜像:路由不打包前端常量,改这里须两处同步 */
const OFFLINE_GATE_SEC = 120
/** 心跳 dt 的硬上界:超过按 7 天计(放置游戏离线上限本就以小时计,这层只防天文数字) */
const DT_MAX_SEC = 7 * 24 * 3600

interface AdvanceResult {
  patches: Record<string, Record<string, unknown>>
  summary: Record<string, unknown> | null
  snapshot: Record<string, unknown> | null
  /** 本拍历练自动结清的际遇文案(1.79.12),随回包带回客户端弹 */
  notices?: string[]
}

type ResolveFn = (
  data: unknown,
  claims: { exp?: unknown; qi?: unknown; session?: unknown },
  ctx: { dtSec: number; offline: boolean }
) => Promise<AdvanceResult | null>

let cached: Promise<{ resolveAdvanceFromSlices: ResolveFn }> | null = null

function clientResolve(): Promise<{ resolveAdvanceFromSlices: ResolveFn }> {
  // 加载失败不缓存 rejected promise:vendor 缺失/损坏是部署事故,修好后不该重启进程才恢复
  cached ??= loadClientModule<{ resolveAdvanceFromSlices: ResolveFn }>(SOURCE_MODULE, VENDOR_FILE)
  cached.catch(() => {
    cached = null
  })
  return cached
}

/** 同一账号两次心跳的最小间隔:生产与签发都有成本,挡高频刷接口 */
const ADVANCE_MIN_GAP_MS = 2_000
/** 限速桶(闸门时刻即落戳,锁内失败也算一拍)与时间锚点(只在成功后推进)分开记 */
const lastGateAt = new Map<number, number>()
/** 每账号上次成功推进时刻(服务端时间锚点;重启清零只放宽一次,兜底用 updated_at) */
const lastAdvanceAt = new Map<number, number>()

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function sliceOf(data: Record<string, unknown>, id: string): Record<string, unknown> {
  const v = data[id]
  return isPlainObject(v) ? v : {}
}

export const gameRouter = express.Router()

gameRouter.post('/game/advance', requireAuth, (req: Request, res: Response) => {
  // 限速留在锁外,闸门时刻即落戳:锁内判断时前一个请求已把时间桶更新过,
  // 排队进来的反而会被放行;失败(结算异常)也算一拍 —— 下拍重来,不放大签发
  const gateAt = Date.now()
  if (gateAt - (lastGateAt.get(req.user!.id) ?? 0) < ADVANCE_MIN_GAP_MS) {
    res.status(429).json({ error: '操作太快,稍候再试' })
    return
  }
  lastGateAt.set(req.user!.id, gateAt)
  void withKeyLock(`save:${req.user!.id}`, async () => {
    const userId = req.user!.id
    const now = Date.now()

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

    // 时间锚点:优先服务端记忆;无记录(重启后首拍)兜底用 saves.updated_at —— 客户端改不了它
    const anchor = lastAdvanceAt.get(userId) ?? row.updated_at
    const dtSec = Math.min(DT_MAX_SEC, Math.max(0, (now - anchor) / 1000))
    if (!(dtSec > 0)) {
      lastAdvanceAt.set(userId, now)
      res.json({ ok: true, slices: {}, offline: null, now })
      return
    }
    const offline = dtSec > OFFLINE_GATE_SEC

    const mod = await clientResolve()
    const resolved = await mod.resolveAdvanceFromSlices(data, body, { dtSec, offline })
    if (resolved === null) {
      res.status(500).json({ error: '推进结算失败' })
      return
    }
    const { patches, summary, snapshot } = resolved

    // 本窗起始的持有快照须在并补丁之前截:after 就是并完补丁的 data 再取一次
    const beforeKeys = heldKeys(data)
    // 键级补丁并进云档(键序不动)
    for (const [slice, fields] of Object.entries(patches)) {
      const cur = sliceOf(data, slice)
      data[slice] = { ...cur, ...fields }
    }

    // 台账补记:本窗签发的新物件(行囊 diff)入台账;记账失败整体回滚为不回包,
    // 客户端留在本地预测,下一拍重来 —— 宁可不发,不带无账之件出闸
    try {
      await syncNewLoot(userId, data, beforeKeys, 'advance')
    } catch {
      res.status(500).json({ error: '签发记账失败,请重试' })
      return
    }

    await upsertByPk('saves', {
      user_id: userId,
      version: row.version,
      data: JSON.stringify(data),
      started: 1,
      // 推进时间锚点的重启兜底就是这个字段(见上面 anchor 的取法);
      // 客户端已不再用它做冲突判定(1.78.0 抛弃存档后没有「谁的档更新」这回事)
      updated_at: now
    })
    lastAdvanceAt.set(userId, now)
    // profiles 跟着推进结果走(复算快照;失败不动,下次上传按存档重算)
    try {
      await syncProfileFromData(userId, data, now)
    } catch {
      // 同突破口径:失败不拦推进
    }
    // 留痕:只有离线结算记一条(GM 后台「审计」列可见),心跳不刷屏
    if (offline && summary !== null) {
      try {
        await run(
          'INSERT INTO save_flags (user_id, name, kind, detail, realm_index, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          [
            userId,
            typeof snapshot?.name === 'string' ? snapshot.name.slice(0, 64) : '',
            'offline_settle',
            `${Math.round(numOf(summary.seconds))}s`,
            0,
            now
          ]
        )
      } catch {
        // 留痕失败不影响推进
      }
    }
    // 留痕:慢拍打点(1.79.10)。水合 17 片 + 整档写回在弱容器上可达数秒,
    // 它直接叠进「历练倒计时归零到开打」的体感;超过 1.5 秒留一行,便于从 docker logs 定位瓶颈
    const durMs = Date.now() - gateAt
    if (durMs > 1500) {
      console.warn('[advance] 慢拍:user=%d %dms patches=%d offline=%s', userId, durMs, Object.keys(patches).length, String(offline))
    }
    // now 随回包走(1.79.10):客户端校钟差用,取组包时刻(而非锁入口时刻,水合可能耗秒级)
    res.json({
      ok: true,
      slices: patches,
      offline: summary,
      // 历练自动结清的际遇文案(1.79.12):勿扰/托管/超时的结清发生在服务端,
      // 文案随回包带回客户端弹 —— 不带就是「倒计时静默重开」
      notices: (resolved.notices ?? []).length > 0 ? resolved.notices : undefined,
      now: Date.now()
    })
  }).catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
})

function numOf(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}
