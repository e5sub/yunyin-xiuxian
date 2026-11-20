/**
 * 经济 op 服务端复算(1.77.0)。
 *
 * 灵石进项账的复算层:客户端自算灵石收入的每条路径(坊市卖出/悬赏交货/洞府巡游/
 * 成就与任务奖励/连胜赏格/秘境层)在入账前先走 op 端点,由本模块按**数据表**复算金额 ——
 * 客户端报的数字一律不作数,只作「定位哪一笔」的索引。复算出的金额由服务端记进
 * stone_ledger,上传存档时按台账放行;没记过账的灵石进项在 saveAuthority 被窗口钳钳回。
 *
 * 本模块必须纯:不碰 store、不碰随机、不碰墙钟(时刻由调用方传 ctx.now)。
 * 进 vendor(build-vendor 第 13 入口),server/src/routes/economy.ts 消费。
 */
import type { GNum } from '@/types'
import { gn, mulN } from '@/utils/gnum'
import { stoneByTier } from './formulas'
import { consignPrice, herbSellBatch, materialSellPrice, marketTier, pillSellPrice } from './marketService'
import { bountyRemainingSec, equipBountyReward, generateBounty, herbBountyReward } from './bountyService'
import { maxTierForMajor } from '@/data/regions'
import { MARKET_MAT_COUNT } from '@/data/market'
import { pillDef } from '@/data/pills'
import { type HerbGrade } from '@/data/herbGrades'
import { qualityDef } from '@/data/qualities'
import { CAVE_EVENT_POOL, WIN_STREAK_REWARDS } from '@/data/earlyGame'
import { ACHIEVEMENTS } from '@/data/achievements'
import { DAILY_TASKS, MAIN_QUESTS } from '@/data/quests'
import { secretLayerReward, secretRealmDef, tierOfMajor, SECRET_LAYERS } from './secretRealm'

export interface EconomyOpRequest {
  kind:
    | 'market_sell_pill'
    | 'market_sell_material'
    | 'market_sell_herb'
    | 'market_sell_consign'
    | 'bounty_claim'
    | 'cave_tour'
    | 'reward_claim'
    | 'streak'
    | 'secret_layer'
  pillId?: unknown
  grade?: unknown
  /** 批量卖出计数(丹/玄铁/灵草):服务端按 count 复算总额,档里存量须 ≥ count */
  count?: unknown
  consignIdx?: unknown
  bountyIdx?: unknown
  bountyUid?: unknown
  eventId?: unknown
  optionIdx?: unknown
  rewardKind?: unknown
  rewardId?: unknown
  streak?: unknown
  realmId?: unknown
  layer?: unknown
}

/** 云档切片(按 op 需要的形状传入;字段缺失按不合法处理)。now 由路由传服务端时刻。 */
export interface EconomyOpCtx {
  now: number
  major: number
  resources?: { ore?: unknown; herbByGrade?: unknown }
  inventory?: { pills?: unknown; items?: unknown }
  market?: { consign?: unknown }
  bounty?: { bountyAt?: unknown; orders?: unknown }
}

export interface EconomyOpResult {
  ok: boolean
  reason?: string
  /** 服务端复算的灵石进项;ok=false 时缺省 */
  stone?: GNum
}

function numOf(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'object' && v !== null) {
    const o = v as { m?: unknown; e?: unknown }
    const m = typeof o.m === 'number' && Number.isFinite(o.m) ? o.m : 0
    const e = typeof o.e === 'number' && Number.isFinite(o.e) ? Math.trunc(o.e) : 0
    return m * Math.pow(10, Math.min(Math.max(e, -30), 30))
  }
  return 0
}

function ok(stone: GNum): EconomyOpResult {
  return { ok: true, stone }
}

function bad(reason: string): EconomyOpResult {
  return { ok: false, reason }
}

function herbGrade(v: unknown, _major: number): HerbGrade | null {
  return typeof v === 'string' && v !== '' ? (v as unknown as HerbGrade) : null
}

function herbCount(res: EconomyOpCtx['resources'], grade: HerbGrade): number {
  const table = res?.herbByGrade
  if (typeof table !== 'object' || table === null) return 0
  return Math.max(0, Math.floor(numOf((table as Record<string, unknown>)[grade])))
}

export function resolveEconomyOp(req: EconomyOpRequest, ctx: EconomyOpCtx): EconomyOpResult {
  if (!Number.isFinite(ctx.now) || ctx.now <= 0) return bad('时刻不合法')
  const major = Math.max(0, Math.min(Math.trunc(ctx.major), 20))
  switch (req.kind) {
    // ---------- 坊市卖出 ----------
    case 'market_sell_pill': {
      const pillId = typeof req.pillId === 'string' ? req.pillId : ''
      const def = pillDef(pillId)
      if (!def?.recipe?.stoneBase) return bad('无价的丹不收')
      const count = Math.min(Math.max(1, Math.trunc(numOf(req.count) || 1)), 999)
      const held = numOf((ctx.inventory?.pills as Record<string, unknown> | undefined)?.[pillId])
      if (held < count) return bad('没有这么多丹')
      return ok(mulN(pillSellPrice(pillId), count))
    }
    case 'market_sell_material': {
      const count = Math.min(Math.max(1, Math.trunc(numOf(req.count) || 1)), 999)
      const ore = Math.floor(numOf(ctx.resources?.ore))
      if (ore < MARKET_MAT_COUNT * count) return bad('玄铁不足')
      return ok(mulN(materialSellPrice(major), count))
    }
    case 'market_sell_herb': {
      const grade = herbGrade(req.grade, major)
      if (grade === null) return bad('品阶不合法')
      const count = Math.min(Math.max(1, Math.trunc(numOf(req.count) || 1)), 999)
      if (herbCount(ctx.resources, grade) < MARKET_MAT_COUNT * count) return bad('灵草不足')
      return ok(mulN(herbSellBatch(grade, major), count))
    }
    case 'market_sell_consign': {
      const idx = Math.trunc(numOf(req.consignIdx))
      const consign = ctx.market?.consign
      if (!Array.isArray(consign) || idx < 0 || idx >= consign.length) return bad('没有这格寄卖')
      const slot = consign[idx] as Record<string, unknown>
      const finishAt = numOf(slot.finishAt)
      if (finishAt <= 0 || finishAt > ctx.now) return bad('寄卖未到期')
      // 价不认客户端存的 price,按 tier+品质现算;tier/品质先钳进合法区间
      const tier = Math.min(Math.max(Math.trunc(numOf(slot.tier)), 0), marketTier(major))
      const rank = Math.min(Math.max(Math.trunc(numOf(slot.qualityRank)), 0), 4)
      return ok(consignPrice(tier, rank))
    }
    // ---------- 悬赏交货 ----------
    case 'bounty_claim': {
      const bountyAt = numOf(ctx.bounty?.bountyAt)
      if (bountyAt <= 0 || bountyRemainingSec(bountyAt, ctx.now) <= 0) return bad('悬赏已换版')
      const idx = Math.trunc(numOf(req.bountyIdx))
      const orders = ctx.bounty?.orders
      if (!Array.isArray(orders)) return bad('没有悬赏订单')
      const slot = orders.find(s => typeof s === 'object' && s !== null && Math.trunc(numOf((s as Record<string, unknown>).idx)) === idx) as
        | Record<string, unknown>
        | undefined
      if (!slot) return bad('没有这单')
      if (slot.claimed === true) return bad('这单已交过')
      // 订单按 (major, bountyAt) 确定性再生,与档里那单对上才算数(防档里造单)
      const regen = generateBounty(major, bountyAt)
      const real = regen.find(s => s.idx === idx)
      if (!real || real.kind !== slot.kind) return bad('这一单对不上版')
      if (real.kind === 'ore') {
        if (Math.floor(numOf(ctx.resources?.ore)) < real.target) return bad('玄铁不够')
        return ok(real.reward)
      }
      if (real.kind === 'herb') {
        const grade = herbGrade(req.grade, major)
        if (grade === null) return bad('品阶不合法')
        if (herbCount(ctx.resources, grade) < real.target) return bad('灵草不够')
        return ok(herbBountyReward(grade, major, real.target))
      }
      if (real.kind === 'pill') {
        const pillId = typeof real.kindId === 'string' ? real.kindId : ''
        const held = numOf((ctx.inventory?.pills as Record<string, unknown> | undefined)?.[pillId])
        if (held < real.target) return bad('丹不够')
        return ok(real.reward)
      }
      // equip:按所交之品(档里现存的件)现算,不认客户端报的数值
      const uid = typeof req.bountyUid === 'string' ? req.bountyUid : ''
      const items = ctx.inventory?.items
      if (!Array.isArray(items)) return bad('行囊为空')
      const eq = items.find(it => typeof it === 'object' && it !== null && (it as Record<string, unknown>).uid === uid) as
        | Record<string, unknown>
        | undefined
      if (!eq) return bad('没有这件兵刃')
      const tier = Math.trunc(numOf(eq.tier))
      if (tier < real.tier) return bad('品阶不够')
      const eqQuality = typeof eq.quality === 'string' ? (eq.quality as unknown as Parameters<typeof qualityDef>[0]) : null
      if (eqQuality === null) return bad('品质不合法')
      const rank = Math.min(Math.max(Math.trunc(numOf(qualityDef(eqQuality).rank)), 0), 4)
      return ok(equipBountyReward(tier, rank).stone)
    }
    // ---------- 洞府巡游 ----------
    case 'cave_tour': {
      const eventId = typeof req.eventId === 'string' ? req.eventId : ''
      const optionIdx = Math.trunc(numOf(req.optionIdx))
      for (const pool of Object.values(CAVE_EVENT_POOL)) {
        const event = pool.find(e => e.id === eventId)
        if (!event) continue
        const opt = event.options[optionIdx]
        if (!opt) return bad('没有这个选项')
        if (opt.reward.type !== 'stone') return ok({ m: 0, e: 0 })
        const value = opt.reward.value
        if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return ok({ m: 0, e: 0 })
        return ok(gn(value))
      }
      return bad('没有这场巡游')
    }
    // ---------- 成就 / 主线 / 日课奖励 ----------
    case 'reward_claim': {
      const id = typeof req.rewardId === 'string' ? req.rewardId : ''
      const kind = req.rewardKind
      let bundle: { stoneTier?: number } | undefined
      if (kind === 'achievement') bundle = ACHIEVEMENTS.find(a => a.id === id)?.reward
      else if (kind === 'main') bundle = MAIN_QUESTS.find(q => q.id === id)?.reward
      else if (kind === 'daily') bundle = DAILY_TASKS.find(t => t.id === id)?.reward
      else return bad('奖励类别不合法')
      if (!bundle) return bad('没有这份奖励')
      if (typeof bundle.stoneTier !== 'number' || bundle.stoneTier <= 0) return ok({ m: 0, e: 0 })
      return ok(stoneByTier(maxTierForMajor(major), bundle.stoneTier))
    }
    // ---------- 连胜赏格 ----------
    case 'streak': {
      const streak = Math.trunc(numOf(req.streak))
      if (streak < 1 || streak > 1000) return bad('连胜数不合法')
      const reward = WIN_STREAK_REWARDS.find(r => r.streak === streak)
      if (!reward || reward.stone <= 0) return ok({ m: 0, e: 0 })
      return ok(gn(reward.stone))
    }
    // ---------- 秘境层 ----------
    case 'secret_layer': {
      const realmId = typeof req.realmId === 'string' ? req.realmId : ''
      const layer = Math.trunc(numOf(req.layer))
      const def = secretRealmDef(realmId)
      if (!def) return bad('没有这座秘境')
      if (layer < 1 || layer > SECRET_LAYERS) return bad('层数不合法')
      return ok(secretLayerReward(tierOfMajor(major), layer, def.rewardMult).stone)
    }
    default:
      return bad('op 类别不合法')
  }
}
