/**
 * 灵草购价 —— 随境界层级缩放的「草比石贵」(Candidate 3ii)。
 *
 * 旧公式(见 history / round-073 tracked deviation)把草锚死成与境界无关的绝对价
 * (1000 × 10^(grade-1)):凡界里「草比石贵」,但石头/装备随 stoneByTier 1.9^tier 指数成长,
 * 两把标尺一交叉就永久分叉 —— realm 10 时一株草 vs 一场战斗的石头已倒挂到约 1/27,
 * realm 18 时最稀有的道品草(1e7)也远小于一场战斗的石头(≈4e8)。这一轮的修正就是把
 * 草价**钉回石头的同一把尺子**上,让「草比石贵」在整条长尾上都成立。
 *
 * 新公式(株):
 *   herbBuyPrice(grade, major) = stoneByTier(tierOfMajor, 64) × 2^(grade-1)
 *   — tierOfMajor 取当前境界的**层级**(maxTierForMajor),
 *   — 64 是「一场逐层指数的战斗 vs 草」的锚(一场战斗 ≈ amount 10,草 = amount 64,
 *     故凡品草:战役石头 ≈ 6.4,道品草 ≈ 100 —— 草贵于石,且这个比值与层级无关)。
 *   — 高一品难采两倍(2^(grade-1)),取代旧「高一品难采十倍」。
 *
 * 结果:**草:战役石头的比值对整条进度恒常**(不再只凡界成立)。
 *
 * 整数性:买价取到 4 的倍数 —— 售=购/2、悬赏每株=购×3/4 都要保持整数(无分石漂移,
 * 见 economyModuleBalance.spec 的整数红线)。
 *
 * 无套利(三条价全随同一 major 走,比值恒 < 1):
 *   购 > 悬赏(×3/4) > 售(×1/2)
 *   —— 草不会「买来转手/交单就赚」,石粮不会凭空生出来。
 */
import type { HerbGrade } from '@/data/herbGrades'
import { maxTierForMajor } from '@/data/regions'
import { toNum } from '@/utils/gnum'
import { stoneByTier } from './formulas'

/** 凡品草一格价锚:一场战斗 ≈ amount 10,草按 amount 64 折算 → 凡品草 ≈ 6.4 战 */
const HERB_STONE_AMOUNT = 64
/** 每一品的珍贵倍率:高一品,难采两倍 */
const HERB_GRADE_STEP = 2

/**
 * 一株灵草的灵石购价(随境界层级缩放,见文件头)。
 * @param major 当前大境界 —— 决定把这株草按「哪一层」的战力/石粮折算
 */
export function herbBuyPrice(grade: HerbGrade, major: number): number {
  const base = toNum(stoneByTier(maxTierForMajor(major), HERB_STONE_AMOUNT))
  const raw = base * Math.pow(HERB_GRADE_STEP, grade - 1)
  // 4 的倍数:售=购/2、悬赏=购×3/4 才恒为整数(见文件头「整数性」)
  return Math.max(0, Math.floor(raw / 4)) * 4
}
