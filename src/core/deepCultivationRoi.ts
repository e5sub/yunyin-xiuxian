/**
 * 深修补偿审计(A/B 两案),只出数据不改代码。
 * 道果对境界二次增长、耗时指数增长,调 KNEE、^0.9、周期折算改不了「浅修最优」的排序。
 *   A 案:把道果阶数提到与耗时同阶,代价是道果重新变成膨胀源。
 *   B 案:道果照旧,给深修另一种回报,验算需要多大的量。
 * 设计立场:允许金丹成为最快的道果农场;要的是让深修成为另一种目标下的最优解。
 */
import { MANUAL_REBIRTH_MIN_MAJOR } from './reincarnation'
import { daoFruitGain } from './formulas'
import { effectiveDaoFruit } from './statsCalc'
import { DAO_FRUIT_COMBAT_BONUS } from '@/data/constants'
import { REBIRTH_REFERENCE_MAJOR } from '@/data/realms'
import { fullHoursToReach, optimalRebirthPoint } from './rebirthRoi'

// ---------------- A 案:道果阶数追平耗时 ----------------

/** 求各境界「道果/耗时」都不低于最优点 floor 比例所需的道果增长率(每境倍数) */
export function requiredFruitGrowth(floor = 0.5): number {
  const lo = MANUAL_REBIRTH_MIN_MAJOR
  const optEff = optimalRebirthPoint().efficiency
  // 二分求解增长率 k:fruit(m) = fruit(lo) × k^(m-lo)
  let low = 1
  let high = 10
  for (let iter = 0; iter < 60; iter += 1) {
    const k = (low + high) / 2
    let ok = true
    for (let m = lo; m <= REBIRTH_REFERENCE_MAJOR; m += 1) {
      const fruit = daoFruitGain(lo, 9) * Math.pow(k, m - lo)
      if (fruit / fullHoursToReach(m + 1) < optEff * floor) {
        ok = false
        break
      }
    }
    if (ok) high = k
    else low = k
  }
  return high
}

export interface ExponentialFruitRow {
  major: number
  /** 当前口径的道果 */
  current: number
  /** A 案下的道果 */
  proposed: number
  /** 放大倍数 */
  inflation: number
  /** A 案下,单世道果换算成的永久战力加成 */
  combatBonus: number
}

/** A 案道果表 */
export function exponentialFruitTable(growth: number): ExponentialFruitRow[] {
  const lo = MANUAL_REBIRTH_MIN_MAJOR
  const base = daoFruitGain(lo, 9)
  const out: ExponentialFruitRow[] = []
  for (let m = lo; m <= REBIRTH_REFERENCE_MAJOR; m += 1) {
    const current = daoFruitGain(m, 9)
    const proposed = base * Math.pow(growth, m - lo)
    out.push({
      major: m,
      current,
      proposed,
      inflation: proposed / current,
      combatBonus: effectiveDaoFruit(proposed) * DAO_FRUIT_COMBAT_BONUS
    })
  }
  return out
}

// ---------------- B 案:深修的第二回报 ----------------

export interface CompensationRow {
  major: number
  fruit: number
  hours: number
  /** 当前效率相对最优点 */
  ratio: number
  /** 追平到最优点 target 比例所需的「等效道果」额外价值 */
  needed: number
  /** 该额外价值相当于本境界道果的多少倍 */
  timesFruit: number
}

/** B 案:深修在纯效率口径下追平所需的第二回报。假定第二回报可与道果折算,结果是纯补偿路线的上界 */
export function compensationTable(target = 0.5): CompensationRow[] {
  const optEff = optimalRebirthPoint().efficiency
  const out: CompensationRow[] = []
  for (let m = MANUAL_REBIRTH_MIN_MAJOR; m <= REBIRTH_REFERENCE_MAJOR; m += 1) {
    const fruit = daoFruitGain(m, 9)
    const hours = fullHoursToReach(m + 1)
    const needed = Math.max(0, optEff * target * hours - fruit)
    out.push({ major: m, fruit, hours, ratio: fruit / hours / optEff, needed, timesFruit: needed / fruit })
  }
  return out
}

/** 不可替代性口径:可作停世点的境界数,即金丹之上每一境各有独特回报时所需的独立路线数 */
export function distinctRouteCount(): number {
  return REBIRTH_REFERENCE_MAJOR - MANUAL_REBIRTH_MIN_MAJOR + 1
}
