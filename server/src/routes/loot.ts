/**
 * 掉落签发(1.58.0):装备掉落的唯一发源地。
 *
 * 客户端只报「在哪打」(来源/层级/场数),掉不掉、掉几件、品质窗口全由服务端裁决:
 * 属性环境从云档分片复算(lootEnv),裁决与实例生成跑客户端同一份 core/lootGrant。
 * 签发出的 uid 记入台账(loot_ledger),上传存档时验源,无账之件移除 ——
 * console 里 push 一件「合法上限内神装」从此进不了档。
 */
import express, { type Request, type Response } from 'express'
import { get } from '../db.js'
import { requireAuth } from '../auth.js'
import { lootEnv } from '../recompute.js'
import { grantLoot, verifyExtraGains } from '../lootGrant.js'
import { recordLoot } from '../lootLedger.js'

export const lootRouter = express.Router()

/** 同一账号两次签发的最小间隔:历练战间隔数秒,300ms 不伤正常节奏,防高频刷接口 */
const CLAIM_MIN_GAP_MS = 300
/** 单次申请的上下文上限(离线整段结算按场次拆条,一批足够) */
const CLAIM_BATCH_MAX = 32
/** 每账号每小时签发件数上限:正常玩到不了(期望 ~10 件/时),刷接口到此为止 */
const HOURLY_GRANT_CAP = 600

const lastClaimAt = new Map<number, number>()
/** 每账号本小时已签发件数(内存即可:重启清零只放宽一次) */
const hourlyGranted = new Map<number, { hour: number; count: number }>()

function underHourlyCap(userId: number, want: number): boolean {
  const hour = Math.floor(Date.now() / 3_600_000)
  const cur = hourlyGranted.get(userId)
  const base = cur && cur.hour === hour ? cur.count : 0
  if (base + want > HOURLY_GRANT_CAP) return false
  hourlyGranted.set(userId, { hour, count: base + want })
  return true
}

lootRouter.post('/loot/claim', requireAuth, (req: Request, res: Response) => {
  void (async () => {
    const userId = req.user!.id
    const now = Date.now()
    const last = lastClaimAt.get(userId) ?? 0
    if (now - last < CLAIM_MIN_GAP_MS) {
      res.status(429).json({ error: '操作太快,稍候再试' })
      return
    }
    lastClaimAt.set(userId, now)

    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>
    const rawClaims = Array.isArray(body.claims) ? body.claims : []
    if (rawClaims.length === 0) {
      res.json({ equips: [] })
      return
    }
    if (rawClaims.length > CLAIM_BATCH_MAX) {
      res.status(400).json({ error: '单次申请过多' })
      return
    }

    // 环境属性从云档复算:客户端自报的 dropRate/luck/境界不作数
    const row = await get<{ data: string }>('SELECT data FROM saves WHERE user_id = ?', [userId])
    if (row === undefined) {
      res.json({ equips: [] })
      return
    }
    let data: unknown = null
    try {
      data = JSON.parse(row.data)
    } catch {
      res.json({ equips: [] })
      return
    }
    const env = await lootEnv(data)
    if (env === null) {
      // 复算不出就不发:宁可不掉,也不按客户端自报的属性签发
      res.json({ equips: [] })
      return
    }

    const grantedBatches: Array<{ src: string; batch: Array<Record<string, unknown>> }> = []
    let want = 0
    for (const ctx of rawClaims) {
      if (!isPlainObject(ctx)) continue
      const granted = await grantLoot(ctx, env)
      if (granted === null) continue
      const batch: Array<Record<string, unknown>> = []
      for (const inst of granted.equips) {
        if (isPlainObject(inst) && typeof inst.uid === 'string') batch.push(inst)
      }
      if (batch.length > 0) {
        grantedBatches.push({ src: String(ctx.src ?? '').slice(0, 16), batch })
        want += batch.length
      }
    }
    // 小时封顶先查再记账:超限的签发不入台账(无账之件上传时本就会被移除,不给玩家错觉)
    if (want > 0 && !underHourlyCap(userId, want)) {
      res.status(429).json({ error: '签发过于频繁,稍候再试' })
      return
    }
    const equips: Array<Record<string, unknown>> = []
    for (const { src, batch } of grantedBatches) {
      await recordLoot(userId, batch.map(e => String(e.uid)), src)
      equips.push(...batch)
    }
    res.json({ equips })
  })().catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
})

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * 法宝与器魂签发(1.58.1)。
 *
 * 这两类物件不是「掉落流程」的一部分:法宝掉不掉在战斗/际遇里掷,器魂由「烧一件凡器」凝出 ——
 * 所以服务端不重新掷点,只做**存在性**与**归属**两件事:数据表里确有其物(validateExtraGains)、
 * 记进台账后上传才不会被验源移除。客户端自报的品阶会被夹回表内合法域。
 *
 * 与 /loot/claim 共用同一套限速与小时封顶:签发流量不因多开一个口子而放大。
 */
lootRouter.post('/loot/extras', requireAuth, (req: Request, res: Response) => {
  void (async () => {
    const userId = req.user!.id
    const now = Date.now()
    const last = lastClaimAt.get(userId) ?? 0
    if (now - last < CLAIM_MIN_GAP_MS) {
      res.status(429).json({ error: '操作太快,稍候再试' })
      return
    }
    lastClaimAt.set(userId, now)

    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>
    const gains = await verifyExtraGains(body)
    if (gains === null) {
      res.json({ artifacts: [], souls: [] })
      return
    }
    const want = gains.artifacts.length + gains.souls.length
    if (want === 0) {
      res.json({ artifacts: [], souls: [] })
      return
    }
    if (!underHourlyCap(userId, want)) {
      res.status(429).json({ error: '签发过于频繁,稍候再试' })
      return
    }
    await recordLoot(userId, gains.artifacts, 'artifact', 'artifact')
    await recordLoot(userId, gains.souls.map(s => s.uid), 'soul', 'soul')
    res.json({ artifacts: gains.artifacts, souls: gains.souls.map(s => s.uid) })
  })().catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
})
