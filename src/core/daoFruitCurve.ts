/**
 * 道果曲线审计:候选曲线在同一把尺子下对照,只出数据不改数值。
 * 长期指标是 marginalPer100(第 100 世到第 200 世是否还值得轮回)。判据不接受硬封顶。
 *
 * 口径警告(saveCalibration 用真实存档验出):小时数经 progressionSim 得出,高估约 100~400 倍,
 * 且假设每世修满真仙(实测在元婴到合体之间就转世,十八世共 22.7 小时)。
 * 只可横向对照曲线形状;不得据此定实际参数,须先在真实存档口径上重建耗时模型。
 */
import { DAO_FRUIT_SOFT_EXP } from '@/data/constants'
import { REBIRTH_REFERENCE_MAJOR } from '@/data/realms'
import { hoursToReach, type SimAssumptions } from './progressionSim'
import { daoFruitAfterLives, FRUIT_PER_LIFE, talentCultBonusAt } from './samsaraAudit'

/** 候选曲线:道果总量 → 有效值(即 effectiveDaoFruit 的位置) */
export interface FruitCurve {
  id: string
  name: string
  desc: string
  bounded: boolean
  effective: (fruit: number) => number
}

/** 对齐基准:所有曲线在「第二世」(道果 168)给出相同有效值,对照形状而非量级 */
const ALIGN_FRUIT = FRUIT_PER_LIFE
const ALIGN_VALUE = Math.pow(ALIGN_FRUIT, DAO_FRUIT_SOFT_EXP)

/** 分段软帽与周期折算的特征量 */
const KNEE = FRUIT_PER_LIFE * 10

export const FRUIT_CURVES: FruitCurve[] = [
  {
    id: 'current',
    name: 'A 当前',
    desc: '效果 ∝ 道果^0.9。次线性但无界——lim n^0.9 = ∞,只是把曲线压平',
    bounded: false,
    effective: f => Math.pow(Math.max(0, f), DAO_FRUIT_SOFT_EXP)
  },
  {
    id: 'log',
    name: 'B 对数',
    desc: '效果 ∝ ln(1+道果)。仍无界,但增长率 ~1/f,深世近乎停滞',
    bounded: false,
    effective: f => (ALIGN_VALUE / Math.log(1 + ALIGN_FRUIT)) * Math.log(1 + Math.max(0, f))
  },
  {
    id: 'softcap',
    name: 'C 分段软帽',
    desc: `拐点 ${KNEE} 枚(约十世)前同当前曲线,之后斜率降到 ^0.5。无界、无断点`,
    bounded: false,
    effective: f => {
      const x = Math.max(0, f)
      if (x <= KNEE) return Math.pow(x, DAO_FRUIT_SOFT_EXP)
      return Math.pow(KNEE, DAO_FRUIT_SOFT_EXP) + Math.pow(x - KNEE, 0.5)
    }
  },
  {
    id: 'hardcap',
    name: 'D 总量封顶',
    desc: `有效值封顶于 ${KNEE} 枚处的水平。数学上干净,但会制造「此后永远无意义」的断点`,
    bounded: true,
    effective: f => Math.min(Math.pow(Math.max(0, f), DAO_FRUIT_SOFT_EXP), Math.pow(KNEE, DAO_FRUIT_SOFT_EXP))
  },
  {
    id: 'partial',
    name: 'E 周期折算',
    desc: `道果照常累积,但只有一部分进入本世有效值:等效量 ${KNEE}·ln(1+f/${KNEE})。前期近线性,后期转对数`,
    bounded: false,
    effective: f => Math.pow(KNEE * Math.log(1 + Math.max(0, f) / KNEE), DAO_FRUIT_SOFT_EXP)
  }
]

export function fruitCurve(id: string): FruitCurve {
  return FRUIT_CURVES.find(c => c.id === id) ?? FRUIT_CURVES[0]!
}

/**
 * 把候选曲线的有效值折算成「当前曲线下的等效道果」,
 * 以复用 progressionSim 的 hoursToReach —— 不复制修行耗时逻辑,免两套口径。
 */
export function equivalentFruit(curve: FruitCurve, fruit: number): number {
  return Math.pow(Math.max(0, curve.effective(fruit)), 1 / DAO_FRUIT_SOFT_EXP)
}

/** 第 n 世的修行假设(与 samsaraAudit 同口径);灵脉随转世归零,不计入 */
function assumptionsAt(lives: number): SimAssumptions {
  return { linggenMult: 1.6, talentCultBonus: talentCultBonusAt(lives - 1) }
}

/** 某曲线下,第 n 世从炼气修满人间界并飞升真仙所需小时 */
export function hoursToPeakUnder(curve: FruitCurve, lives: number): number {
  return hoursToReach(REBIRTH_REFERENCE_MAJOR, equivalentFruit(curve, daoFruitAfterLives(lives - 1)), assumptionsAt(lives))
}

export interface CurveRow {
  life: number
  /** 该世单独修满真仙的耗时 */
  hours: number
  /** 从第一世算起的累计耗时 */
  cumulative: number
  /** 相对第一世的耗时比例 */
  vsFirst: number
  /** 再轮回一百世能把单世耗时再压掉多少(0~1) */
  marginalPer100: number
}

/** 累计耗时按「逐世相加」算,不含历练、渡劫、等灵气,不等于玩家真实总时长 */
export function curveTable(curve: FruitCurve, lifeList: number[]): CurveRow[] {
  const first = hoursToPeakUnder(curve, 1)
  let cumulative = 0
  let prevLife = 0
  return lifeList.map(life => {
    // 累计:(prevLife, life] 区间按端点值近似,不逐世跑满
    const hours = hoursToPeakUnder(curve, life)
    const prevHours = prevLife > 0 ? hoursToPeakUnder(curve, prevLife) : first
    cumulative += ((hours + prevHours) / 2) * (life - prevLife)
    prevLife = life
    return {
      life,
      hours,
      cumulative,
      vsFirst: first > 0 ? hours / first : 1,
      marginalPer100: hours > 0 ? 1 - hoursToPeakUnder(curve, life + 100) / hours : 0
    }
  })
}

/** 主要设计窗口(1~30 世);再往后允许继续玩,不要求核心成长继续膨胀 */
export const LIFECYCLE_LIVES = [1, 2, 3, 5, 8, 10, 15, 20, 25, 30] as const

/** 生命周期窗口的末端,用作「优势兑现度」的分母 */
export const LIFECYCLE_HORIZON = 30

/** E 周期折算的参数化版本:拐点位置(kneeLives)可调 */
export function partialCurve(kneeLives: number): FruitCurve {
  const knee = FRUIT_PER_LIFE * Math.max(1, kneeLives)
  return {
    id: `partial${kneeLives}`,
    name: `E/拐点${kneeLives}世`,
    desc: `道果照常累积,有效量取 ${knee.toFixed(0)}·ln(1+f/${knee.toFixed(0)});衰减集中在第 ${kneeLives} 世附近`,
    bounded: false,
    effective: f => Math.pow(knee * Math.log(1 + Math.max(0, f) / knee), DAO_FRUIT_SOFT_EXP)
  }
}

/** 逐世边际收益:再多轮回一世,单世耗时能再压掉多少 */
export function marginalPerLife(curve: FruitCurve, lives: number): number {
  const h = hoursToPeakUnder(curve, lives)
  if (h <= 0) return 0
  return 1 - hoursToPeakUnder(curve, lives + 1) / h
}

/** 优势兑现度:到第 n 世为止,兑现了「前 horizon 世全部轮回优势」的多少;判断衰减位置的主指标 */
export function redemptionAt(curve: FruitCurve, lives: number, horizon = LIFECYCLE_HORIZON): number {
  const h1 = hoursToPeakUnder(curve, 1)
  const hEnd = hoursToPeakUnder(curve, horizon)
  const total = h1 - hEnd
  if (total <= 0) return 1
  return (h1 - hoursToPeakUnder(curve, lives)) / total
}

export interface LifecycleRow {
  life: number
  hours: number
  vsFirst: number
  /** 再轮回一世的收益 */
  marginal: number
  /** 前 30 世优势的兑现进度 */
  redemption: number
}

/** 生命周期窗口内的逐世读数 */
export function lifecycleTable(curve: FruitCurve, lives: readonly number[] = LIFECYCLE_LIVES): LifecycleRow[] {
  const h1 = hoursToPeakUnder(curve, 1)
  return lives.map(life => {
    const hours = hoursToPeakUnder(curve, life)
    return {
      life,
      hours,
      vsFirst: h1 > 0 ? hours / h1 : 1,
      marginal: marginalPerLife(curve, life),
      redemption: redemptionAt(curve, life)
    }
  })
}

/** 各曲线在深世的收敛形态(渐隐还是断崖) */
export interface ConvergenceRow {
  curve: FruitCurve
  /** 第 100 世的单世耗时 */
  h100: number
  /** 第 500 世的单世耗时 */
  h500: number
  /** 100→200 世的边际收益 */
  marginal100: number
  /** 400→500 世的边际收益 */
  marginal400: number
  /** 是否存在断点(某处边际收益骤降到近零) */
  hasCliff: boolean
}

export function convergence(): ConvergenceRow[] {
  return FRUIT_CURVES.map(curve => {
    const h100 = hoursToPeakUnder(curve, 100)
    const h500 = hoursToPeakUnder(curve, 500)
    const marginal100 = 1 - hoursToPeakUnder(curve, 200) / h100
    const marginal400 = 1 - h500 / hoursToPeakUnder(curve, 400)
    // 断崖判据:封顶类曲线在拐点之后边际收益直接为 0
    const hasCliff = marginal100 < 1e-6 && marginal400 < 1e-6
    return { curve, h100, h500, marginal100, marginal400, hasCliff }
  })
}
