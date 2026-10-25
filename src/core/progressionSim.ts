/**
 * 进度模拟器(纯函数):基于真实公式估算各境界耗时与多周目加速曲线。
 * 未计入突破失败/灵气等待/历练时间,真实耗时约为估算的 1.5~3 倍。
 */
import { toNum } from '@/utils/gnum'
import { DAO_FRUIT_CULT_BONUS, SUB_LEVELS } from '@/data/constants'
import { baseCultPerSec, daoFruitGain, expRequirement } from './formulas'
import { effectiveDaoFruit } from './statsCalc'
import { BUILDINGS } from '@/data/buildings'

/** 洞府建筑满级修速加成合计,从建筑表算,不手写(76% = 洞府 4 级 ×4% + 聚灵阵 20 级 ×3%) */
export const BUILDING_CULT_CAP = BUILDINGS.reduce(
  (sum, b) => sum + (typeof b.mods === 'function' ? (b.mods(b.maxLevel).cultivationSpeed ?? 0) : 0),
  0
)

export interface SimAssumptions {
  /** 灵根修行倍率(典型值 1.6) */
  linggenMult: number
  /** 转世天赋累计的修速加成 */
  talentCultBonus: number
}

export const DEFAULT_ASSUMPTIONS: SimAssumptions = { linggenMult: 1.6, talentCultBonus: 0 }

/** 某大境界阶段的稳态修速总倍率估计 */
export function estimateCultMult(major: number, daoFruit: number, a: SimAssumptions = DEFAULT_ASSUMPTIONS): number {
  return 1 + cultMultParts(major, daoFruit, a).reduce((s, p) => s + p.value, 0)
}

/** 模型假设的修速加成分项,每一项都须能被真实内容覆盖 */
export interface CultPart {
  name: string
  value: number
}

export function cultMultParts(major: number, daoFruit: number, a: SimAssumptions = DEFAULT_ASSUMPTIONS): CultPart[] {
  return [
    { name: '灵根', value: a.linggenMult - 1 },
    { name: '天赋', value: a.talentCultBonus },
    { name: '功法', value: 0.12 + 0.055 * major },
    { name: '辅修', value: 0.06 + 0.05 * major },
    { name: '装备', value: 0.05 + 0.03 * major },
    { name: '洞府', value: Math.min(BUILDING_CULT_CAP, 0.1 + 0.09 * major) },
    { name: '灵气充盈', value: 0.15 },
    { name: '道果', value: effectiveDaoFruit(daoFruit) * DAO_FRUIT_CULT_BONUS }
  ].filter(p => p.value !== 0)
}

/** 修满一个大境界(一层到圆满)所需秒数 */
export function secondsForMajor(major: number, daoFruit: number, a: SimAssumptions = DEFAULT_ASSUMPTIONS): number {
  const mult = estimateCultMult(major, daoFruit, a)
  let total = 0
  for (let s = 0; s < SUB_LEVELS; s += 1) {
    total += toNum(expRequirement(major, s)) / (baseCultPerSec(major, s) * mult)
  }
  return total
}

/** 到达目标大境界的累计小时数(即完成其之前所有大境界) */
export function hoursToReach(targetMajor: number, daoFruit: number, a: SimAssumptions = DEFAULT_ASSUMPTIONS): number {
  let sec = 0
  for (let m = 0; m < targetMajor; m += 1) {
    sec += secondsForMajor(m, daoFruit, a)
  }
  return sec / 3600
}

export interface LifeRow {
  life: number
  daoFruit: number
  toZhuji: number
  toJindan: number
  toYuanying: number
}

/** 多周目对照表:每世修至元婴后转世;天赋每世 +6% 修速,封顶 40% */
export function multiLifeTable(lives: number[]): LifeRow[] {
  const perLifeFruit = daoFruitGain(3, 0)
  return lives.map(life => {
    const daoFruit = (life - 1) * perLifeFruit
    const a: SimAssumptions = {
      linggenMult: 1.6,
      talentCultBonus: Math.min(0.4, (life - 1) * 0.06)
    }
    return {
      life,
      daoFruit,
      toZhuji: hoursToReach(1, daoFruit, a),
      toJindan: hoursToReach(2, daoFruit, a),
      toYuanying: hoursToReach(3, daoFruit, a)
    }
  })
}

/** 第一世里程碑表(供审计输出) */
export function firstLifeMilestones(): { major: number; hours: number }[] {
  const out: { major: number; hours: number }[] = []
  for (let m = 1; m <= 9; m += 1) {
    out.push({ major: m, hours: hoursToReach(m, 0) })
  }
  return out
}
