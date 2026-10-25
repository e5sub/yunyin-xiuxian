/**
 * 坊市悬赏板:订单生成 / 定价 / 贡器现算。全走 stoneByTier 与炼制石耗,不另立经济口径。
 * 募材、募丹价介于摆摊售出与坊市购入之间(无「买→交」套利);贡器价随所交之品的品质,恒低于坊市购入同品质。
 */
import type { GNum } from '@/types'
import { gn, gnZero, mulN } from '@/utils/gnum'
import { stoneByTier } from './formulas'
import { pillDef } from '@/data/pills'
import { pillStoneCost } from './pillService'
import { salePills, marketTier } from './marketService'
import { herbBuyPrice } from './herbPrice'
import type { HerbGrade } from '@/data/herbGrades'
import { MARKET_MAT_STONE_UNITS } from '@/data/market'
import {
  BOUNTY_SLOTS,
  BOUNTY_REFRESH_SECONDS,
  BOUNTY_MAT_TARGET,
  BOUNTY_MAT_UNIT_AMOUNT,
  BOUNTY_PILL_COUNT,
  BOUNTY_PILL_REWARD_FACTOR,
  BOUNTY_PILL_WUDAO,
  BOUNTY_EQUIP_STONE_BASE,
  BOUNTY_EQUIP_STONE_PER_RANK,
  BOUNTY_EQUIP_DUST_BASE,
  type BountySlot
} from '@/data/bounty'

/** 每轮取一味当前境界可达的可炼丹(与坊市货架同口径 salePills),按刷新周期取模,同周期内稳定 */
function pickPill(major: number, now: number): string {
  const pool = salePills(major).map(p => p.id)
  const idx = Math.floor(now / (BOUNTY_REFRESH_SECONDS * 1000)) % Math.max(1, pool.length)
  return pool[idx] ?? ''
}

/** 贡一柄 ≥门槛 兵刃可得(随所交之品的品质现算) */
export function equipBountyReward(tier: number, qualityRank: number): { stone: GNum; dust: number } {
  return {
    stone: stoneByTier(tier, BOUNTY_EQUIP_STONE_BASE + qualityRank * BOUNTY_EQUIP_STONE_PER_RANK),
    dust: BOUNTY_EQUIP_DUST_BASE + qualityRank
  }
}

/** 募草交货可得:按所交品阶计价、按当前境界层级折算;每株 = 购价 ×(悬赏档 4.5 / 购入档 6) */
export function herbBountyReward(grade: HerbGrade, major: number, target: number): GNum {
  // 购价是 4 的倍数,×3/4 恒为整数;round 只抹浮点尾差
  const unit = Math.round(herbBuyPrice(grade, major) * (BOUNTY_MAT_UNIT_AMOUNT / MARKET_MAT_STONE_UNITS))
  return mulN(gn(unit), target)
}

/** 生成一版悬赏订单(四类各一);贡器/募草 reward 为占位,交货时按所交之品现算 */
export function generateBounty(major: number, now: number): BountySlot[] {
  const pillId = pickPill(major, now)
  const pd = pillDef(pillId)
  const matTarget = BOUNTY_MAT_TARGET
  const oreReward = stoneByTier(marketTier(major), matTarget * BOUNTY_MAT_UNIT_AMOUNT)
  /** 挑不出可炼丹时募丹位落回募草:空 kindId 的丹单交不掉 */
  const pillSlot: BountySlot = pd
    ? {
        idx: 2,
        kind: 'pill',
        kindId: pd.id,
        target: BOUNTY_PILL_COUNT,
        tier: 0,
        reward: pd.recipe?.stoneBase ? mulN(pillStoneCost(pd), BOUNTY_PILL_COUNT * BOUNTY_PILL_REWARD_FACTOR) : gnZero(),
        extra: BOUNTY_PILL_WUDAO,
        claimed: false
      }
    : { idx: 2, kind: 'herb', kindId: 'herb', target: matTarget, tier: 0, reward: gnZero(), extra: 0, claimed: false }
  const slots: BountySlot[] = [
    { idx: 0, kind: 'herb', kindId: 'herb', target: matTarget, tier: 0, reward: gnZero(), extra: 0, claimed: false },
    { idx: 1, kind: 'ore', kindId: 'ore', target: matTarget, tier: 0, reward: oreReward, extra: 0, claimed: false },
    pillSlot,
    { idx: 3, kind: 'equip', kindId: '', target: 1, tier: marketTier(major), reward: gnZero(), extra: 0, claimed: false }
  ]
  return slots.slice(0, Math.min(BOUNTY_SLOTS, slots.length))
}

/** 悬赏板还剩多久换新(秒);已过期返回 0 */
export function bountyRemainingSec(bountyAt: number, now: number): number {
  return Math.max(0, bountyAt + BOUNTY_REFRESH_SECONDS * 1000 - now) / 1000
}
