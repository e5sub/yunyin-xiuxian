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
  /**
   * 本窗口**已记过**的消费/领取(key → 数量),见 server/src/economyLedger(1.77.1)。
   * 扣货写在客户端、云端档要到下一次上传才少掉 —— 不扣掉这份已记量,同一批货能反复记账。
   */
  claimed?: Record<string, number>
}

export interface EconomyOpResult {
  ok: boolean
  reason?: string
  /** 服务端复算的灵石进项;ok=false 时缺省 */
  stone?: GNum
  /** 记账时要一并落下的消费/领取(1.77.1);permanent = 一次性奖励,永不随上传清理 */
  consume?: { key: string; qty: number; permanent?: boolean }
  /**
   * 应从云档扣掉的货物(1.79.12):卖出/悬赏交货的「扣货」此前全靠 claims 临时行挡
   * 重复,而云档行囊从未少掉 —— 已卖的货重登复活,悬赏装备件复活后可反复交或二次分解。
   * 现由路由按这份清单直接改云档,claims 只剩「同拍防重放」一层安全网。
   */
  deduct?: EconomyDeduct[]
  /**
   * 应随本笔落进云档的非灵石进项(1.79.12):秘境逐层的灵草与通关悟道点此前只进
   * 本地 store,心跳一拍就被云档值顶回(秒级蒸发)。
   */
  gains?: { herb?: number; wudao?: number }
}

/** 扣货指令(1.79.12):kind 决定路由改云档哪个位置;形状非法的整条忽略 */
export interface EconomyDeduct {
  kind: 'pill' | 'ore' | 'herb' | 'item' | 'consign' | 'bounty_mark'
  /** pill/ore 用:丹药 id */
  id?: string
  /** herb 用:品阶(数据层 HerbGrade 是数字档位) */
  grade?: HerbGrade
  /** item 用:装备 uid */
  uid?: string
  /** consign/bounty_mark 用:格子下标 */
  idx?: number
  /** 扣多少(ore/herb/pill);item/consign/bounty_mark 恒整件/整格 */
  qty?: number
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

/** 复算通过且要记一笔消费/领取:金额与被消耗的量一起回给路由落账 */
function okConsume(stone: GNum, key: string, qty: number, permanent = false): EconomyOpResult {
  return { ok: true, stone, consume: { key, qty, permanent } }
}

/** okConsume 之上再带扣货清单(1.79.12):路由据此把货物从云档扣掉 */
function okConsumeDeduct(stone: GNum, key: string, qty: number, deduct: EconomyDeduct[]): EconomyOpResult {
  return { ok: true, stone, consume: { key, qty }, deduct }
}

/** 日键(UTC+8):与 server/src/dungeonCore 的 dayKey 同口径,日课/连胜/巡游按它分天 */
function dayKeyOf(now: number): string {
  return new Date(now + 8 * 3600_000).toISOString().slice(0, 10)
}

/** 本窗口已记过的量 */
function claimedOf(ctx: EconomyOpCtx, key: string): number {
  const v = ctx.claimed?.[key]
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.trunc(v) : 0
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
      const key = `sell:pill:${pillId}`
      // 档里的丹以云档现值为准(1.79.12 起卖出当场扣档,claims 只是同拍防重放的安全网)
      if (held - claimedOf(ctx, key) < count) return bad('没有这么多丹')
      return okConsumeDeduct(mulN(pillSellPrice(pillId), count), key, count, [
        { kind: 'pill', id: pillId, qty: count }
      ])
    }
    case 'market_sell_material': {
      const count = Math.min(Math.max(1, Math.trunc(numOf(req.count) || 1)), 999)
      const ore = Math.floor(numOf(ctx.resources?.ore))
      const need = MARKET_MAT_COUNT * count
      if (ore - claimedOf(ctx, 'sell:ore') < need) return bad('玄铁不足')
      return okConsumeDeduct(mulN(materialSellPrice(major), count), 'sell:ore', need, [
        { kind: 'ore', qty: need }
      ])
    }
    case 'market_sell_herb': {
      const grade = herbGrade(req.grade, major)
      if (grade === null) return bad('品阶不合法')
      const count = Math.min(Math.max(1, Math.trunc(numOf(req.count) || 1)), 999)
      const need = MARKET_MAT_COUNT * count
      const key = `sell:herb:${grade}`
      if (herbCount(ctx.resources, grade) - claimedOf(ctx, key) < need) return bad('灵草不足')
      return okConsumeDeduct(mulN(herbSellBatch(grade, major), count), key, need, [
        { kind: 'herb', grade, qty: need }
      ])
    }
    case 'market_sell_consign': {
      const idx = Math.trunc(numOf(req.consignIdx))
      const consign = ctx.market?.consign
      if (!Array.isArray(consign) || idx < 0 || idx >= consign.length) return bad('没有这格寄卖')
      const slot = consign[idx] as Record<string, unknown>
      const finishAt = numOf(slot.finishAt)
      if (finishAt <= 0 || finishAt > ctx.now) return bad('寄卖未到期')
      // 同一格收一次:收取后由路由把云档里的这一格删掉(1.79.12),不再靠 claims 挡
      const key = `sell:consign:${idx}:${Math.trunc(finishAt)}`
      if (claimedOf(ctx, key) > 0) return bad('这格已收过')
      // 价不认客户端存的 price,按 tier+品质现算;tier/品质先钳进合法区间
      const tier = Math.min(Math.max(Math.trunc(numOf(slot.tier)), 0), marketTier(major))
      const rank = Math.min(Math.max(Math.trunc(numOf(slot.qualityRank)), 0), 4)
      return okConsumeDeduct(consignPrice(tier, rank), key, 1, [{ kind: 'consign', idx }])
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
      // 交过之后档里的 claimed 标记还要等下一次上传才落库;本窗口按 key 记一笔,防同一单反复领赏
      const claimKey = `bounty:${Math.trunc(bountyAt)}:${idx}`
      if (claimedOf(ctx, claimKey) > 0) return bad('这单已交过')
      // 订单按 (major, bountyAt) 确定性再生,与档里那单对上才算数(防档里造单)
      const regen = generateBounty(major, bountyAt)
      const real = regen.find(s => s.idx === idx)
      if (!real || real.kind !== slot.kind) return bad('这一单对不上版')
      if (real.kind === 'ore') {
        if (Math.floor(numOf(ctx.resources?.ore)) < real.target) return bad('玄铁不够')
        // 扣货 + 云档标记已领(1.79.12):不然重登后这单还能再交
        return okConsumeDeduct(real.reward, claimKey, 1, [
          { kind: 'ore', qty: real.target },
          { kind: 'bounty_mark', idx }
        ])
      }
      if (real.kind === 'herb') {
        const grade = herbGrade(req.grade, major)
        if (grade === null) return bad('品阶不合法')
        if (herbCount(ctx.resources, grade) < real.target) return bad('灵草不够')
        return okConsumeDeduct(herbBountyReward(grade, major, real.target), claimKey, 1, [
          { kind: 'herb', grade, qty: real.target },
          { kind: 'bounty_mark', idx }
        ])
      }
      if (real.kind === 'pill') {
        const pillId = typeof real.kindId === 'string' ? real.kindId : ''
        const held = numOf((ctx.inventory?.pills as Record<string, unknown> | undefined)?.[pillId])
        if (held < real.target) return bad('丹不够')
        return okConsumeDeduct(real.reward, claimKey, 1, [
          { kind: 'pill', id: pillId, qty: real.target },
          { kind: 'bounty_mark', idx }
        ])
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
      // 交出的整件从云档行囊移除(1.79.12):否则件复活,换一版悬赏再交同一件就是白拿赏金
      return okConsumeDeduct(equipBountyReward(tier, rank).stone, claimKey, 1, [
        { kind: 'item', uid },
        { kind: 'bounty_mark', idx }
      ])
    }
    // ---------- 洞府巡游 ----------
    case 'cave_tour': {
      const eventId = typeof req.eventId === 'string' ? req.eventId : ''
      const optionIdx = Math.trunc(numOf(req.optionIdx))
      // 每日一次:件数账之外再记一条日键,防「先报一次零收益选项、再报带灵石的那条」
      const claimKey = `cave:${dayKeyOf(ctx.now)}`
      if (claimedOf(ctx, claimKey) > 0) return bad('今日已巡游')
      for (const pool of Object.values(CAVE_EVENT_POOL)) {
        const event = pool.find(e => e.id === eventId)
        if (!event) continue
        const opt = event.options[optionIdx]
        if (!opt) return bad('没有这个选项')
        if (opt.reward.type !== 'stone') return okConsume(gn(0), claimKey, 1, true)
        const value = opt.reward.value
        if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return okConsume(gn(0), claimKey, 1, true)
        return okConsume(gn(value), claimKey, 1, true)
      }
      return bad('没有这场巡游')
    }
    // ---------- 成就 / 主线 / 日课奖励 ----------
    case 'reward_claim': {
      const id = typeof req.rewardId === 'string' ? req.rewardId : ''
      const kind = req.rewardKind
      // 一次性奖励:成就/主线终身一次,日课按日一次(日键 UTC+8)
      if (kind !== 'achievement' && kind !== 'main' && kind !== 'daily') return bad('奖励类别不合法')
      const claimKey = `reward:${kind}:${id}${kind === 'daily' ? `:${dayKeyOf(ctx.now)}` : ''}`
      if (claimedOf(ctx, claimKey) > 0) return bad('这份奖励已领过')
      let bundle: { stoneTier?: number } | undefined
      if (kind === 'achievement') bundle = ACHIEVEMENTS.find(a => a.id === id)?.reward
      else if (kind === 'main') bundle = MAIN_QUESTS.find(q => q.id === id)?.reward
      else bundle = DAILY_TASKS.find(t => t.id === id)?.reward
      if (!bundle) return bad('没有这份奖励')
      if (typeof bundle.stoneTier !== 'number' || bundle.stoneTier <= 0) return okConsume(gn(0), claimKey, 1, true)
      return okConsume(stoneByTier(maxTierForMajor(major), bundle.stoneTier), claimKey, 1, true)
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
      // 灵草(每层)与通关悟道点(终层 +3)一并回传落档(1.79.12):此前只进本地 store,
      // 心跳一拍就被云档值顶回。灵石照旧走 stone。
      const reward = secretLayerReward(tierOfMajor(major), layer, def.rewardMult)
      const gains: { herb?: number; wudao?: number } = { herb: reward.material }
      if (layer >= SECRET_LAYERS) gains.wudao = 3
      return { ok: true, stone: reward.stone, gains }
    }
    default:
      return bad('op 类别不合法')
  }
}
