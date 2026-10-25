/**
 * 灵草购价(株):stoneByTier(maxTierForMajor(major), 64) × 2^(grade-1)。
 * 与石头同一把尺子随层级缩放,草:战役石头比值对整条进度恒常;锚成与境界无关的绝对价会在高境倒挂。
 * 无套利:三条价随同一 major 走,购 > 悬赏(×3/4) > 售(×1/2)。
 */
import type { HerbGrade } from '@/data/herbGrades'
import { maxTierForMajor } from '@/data/regions'
import { toNum } from '@/utils/gnum'
import { stoneByTier } from './formulas'

/** 价锚:一场战斗 ≈ amount 10,草按 amount 64 折算,凡品草 ≈ 6.4 战 */
const HERB_STONE_AMOUNT = 64
/** 每一品的珍贵倍率 */
const HERB_GRADE_STEP = 2

/** 一株灵草的灵石购价;major(当前大境界)决定按哪一层的石粮折算 */
export function herbBuyPrice(grade: HerbGrade, major: number): number {
  const base = toNum(stoneByTier(maxTierForMajor(major), HERB_STONE_AMOUNT))
  const raw = base * Math.pow(HERB_GRADE_STEP, grade - 1)
  // 4 的倍数:售=购/2、悬赏=购×3/4 恒为整数(economyModuleBalance.spec 整数红线)
  return Math.max(0, Math.floor(raw / 4)) * 4
}
