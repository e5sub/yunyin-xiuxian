/**
 * 轮回 ROI 审计:比较「继续本世深修」与「立刻轮回重刷」的道果效率。
 * 耗时用 fullHoursToReach(含修速倍率、突破失败重试与灵气等待);
 * 绝对值不可信(见 saveCalibration),只用同一把尺子下的比值。
 */
import { MANUAL_REBIRTH_MIN_MAJOR } from './reincarnation'
import { baseCultPerSec, baseQiRegen, breakthroughBaseRate, daoFruitGain, expRequirement, qiCap } from './formulas'
import { DEFAULT_ASSUMPTIONS, type SimAssumptions, estimateCultMult } from './progressionSim'
import { BT_FAIL_EXP_LOSS, BT_QI_COST_RATIO, SUB_LEVELS } from '@/data/constants'
import { toNum } from '@/utils/gnum'
import { REBIRTH_REFERENCE_MAJOR } from '@/data/realms'

/**
 * 修满一个大境界的完整耗时(秒):修为累积 + 突破失败重试 + 灵气等待。
 * 历练时间未计入(真实存档显示它与修炼并行,不是纯串行成本)。
 */
export function fullSecondsForMajor(major: number, daoFruit = 0, a: SimAssumptions = DEFAULT_ASSUMPTIONS): number {
  const mult = estimateCultMult(major, daoFruit, a)
  let sec = 0
  for (let s = 0; s < SUB_LEVELS; s += 1) {
    const req = toNum(expRequirement(major, s))
    const speed = baseCultPerSec(major, s) * mult
    const rate = breakthroughBaseRate(major, s)
    const tries = 1 / rate
    // 修为:首次攒满 + 每次失败后重攒损失的部分
    const expSec = (req / speed) * (1 + (tries - 1) * BT_FAIL_EXP_LOSS)
    // 灵气:每次尝试都要攒够
    const qiSec = ((qiCap(major, s) * BT_QI_COST_RATIO) / baseQiRegen(major)) * tries
    sec += expSec + qiSec
  }
  return sec
}

/** 从零修满到某大境界的完整耗时(小时) */
export function fullHoursToReach(targetMajor: number, daoFruit = 0, a: SimAssumptions = DEFAULT_ASSUMPTIONS): number {
  let sec = 0
  for (let m = 0; m < targetMajor; m += 1) sec += fullSecondsForMajor(m, daoFruit, a)
  return sec / 3600
}

/** 转世点:玩家在某个大境界圆满时选择轮回 */
export interface RebirthPoint {
  major: number
  /** 该境界圆满转世可凝的道果 */
  fruit: number
  /** 从零修满该境界的相对耗时(单位不可信,仅供比值) */
  hours: number
  /** 道果效率 = 道果 / 耗时 */
  efficiency: number
}

/** 合法转世点(金丹起,低于此境界不允许手动轮回) */
export function rebirthPoints(): RebirthPoint[] {
  const out: RebirthPoint[] = []
  for (let m = MANUAL_REBIRTH_MIN_MAJOR; m <= REBIRTH_REFERENCE_MAJOR; m += 1) {
    const fruit = daoFruitGain(m, 9)
    const hours = fullHoursToReach(m + 1)
    out.push({ major: m, fruit, hours, efficiency: fruit / hours })
  }
  return out
}

/** 效率最高的转世点 */
export function optimalRebirthPoint(): RebirthPoint {
  return rebirthPoints().reduce((a, b) => (b.efficiency > a.efficiency ? b : a))
}

export interface MarginalRow {
  from: number
  to: number
  /** 多修一境多得的道果 */
  fruitGain: number
  /** 多修一境多花的时间 */
  hoursCost: number
  /** 该段的边际效率 */
  marginal: number
  /** 相对「重刷一轮最优转世点」的效率占比 */
  vsOptimal: number
}

/** 边际账:再往上修一境值不值;参照物是「立刻轮回、重刷一轮最优转世点」 */
export function marginalTable(): MarginalRow[] {
  const opt = optimalRebirthPoint()
  const out: MarginalRow[] = []
  for (let m = MANUAL_REBIRTH_MIN_MAJOR; m < REBIRTH_REFERENCE_MAJOR; m += 1) {
    const fruitGain = daoFruitGain(m + 1, 9) - daoFruitGain(m, 9)
    const hoursCost = fullHoursToReach(m + 2) - fullHoursToReach(m + 1)
    const marginal = hoursCost > 0 ? fruitGain / hoursCost : 0
    out.push({ from: m, to: m + 1, fruitGain, hoursCost, marginal, vsOptimal: marginal / opt.efficiency })
  }
  return out
}

/**
 * 结构成因:道果 = Σ(i+1)×DAO_FRUIT_PER_MAJOR,对境界二次增长;
 * 耗时按 EXP_MAJOR_GROWTH/CULT_MAJOR_SPEED_GROWTH 指数增长。
 */
export interface GrowthOrders {
  /** 金丹→真仙的道果倍数 */
  fruitSpan: number
  /** 金丹→真仙的耗时倍数 */
  hoursSpan: number
  /** 效率跌幅 */
  efficiencyDrop: number
}

export function growthOrders(): GrowthOrders {
  const lo = MANUAL_REBIRTH_MIN_MAJOR
  const fruitSpan = daoFruitGain(REBIRTH_REFERENCE_MAJOR, 9) / daoFruitGain(lo, 9)
  const hoursSpan = fullHoursToReach(REBIRTH_REFERENCE_MAJOR + 1) / fullHoursToReach(lo + 1)
  return { fruitSpan, hoursSpan, efficiencyDrop: hoursSpan / fruitSpan }
}
