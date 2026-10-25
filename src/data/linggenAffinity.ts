/**
 * 灵根亲和:一世的天然牌面。三条接线皆为倾向,无直接数值加成:
 *   ① 功法习得偏向:同源功法更易参悟(不独占)
 *   ② 机缘出现偏向:同源机缘更易撞见
 *   ③ 天劫解法空间:被劫型关掉的某条路对其半开(不是成功率)
 * 红线:
 *   - 不做「灵根 → 修速」:与道果同池,道果每世无上限累积(linggenRole.spec.ts 实测第20世:道果占修速 74.2%,灵根 1.2%)
 *   - 不做「灵根 → 天劫成功率 +X%」:会复活「渡劫单指标优化」
 *   - 灵根提供倾向,不提供职业
 */
import type { ElementId } from '@/types'
import type { TribulationKind } from './tribulations'

/** 天劫解法修正:改变「哪些词条在这道劫里管用」,不改成功率;每项是对劫型限制的部分回拉,无对应构筑即无收益 */
export interface TribulationRelief {
  /** 护盾折扣回拉比例(0=无效果, 1=完全无视该劫的碾盾) */
  shieldRestore: number
  /** 治疗压制回拉比例 */
  healRestore: number
  /** 前重波形的起手削减比例 */
  frontLoadEase: number
  /** 爆发削劫的星级加成(裂魂劫查表下标) */
  burstTierBonus: number
  /** 减伤折算天劫抗性的额外比例 */
  reductionToResist: number
}

export const NO_RELIEF: TribulationRelief = {
  shieldRestore: 0,
  healRestore: 0,
  frontLoadEase: 0,
  burstTierBonus: 0,
  reductionToResist: 0
}

export interface ElementAffinity {
  /** 同源功法的参悟权重倍率(倾向,非独占) */
  gongfaWeight: number
  /** 同源机缘的出现权重倍率 */
  fortuneWeight: number
  /** 该元素在哪种劫型下解锁解法通道;chaos 为 null 表示通吃 */
  kind: TribulationKind | null
  /** 解锁的解法通道 */
  relief: Partial<TribulationRelief>
  /** 道途倾向(UI 展示;只描述牌面,不承诺数值) */
  tendency: string
}

/** 各元素的天然牌面 */
export const ELEMENT_AFFINITY: Record<ElementId, ElementAffinity> = {
  metal: {
    gongfaWeight: 2.2,
    fortuneWeight: 2.5,
    kind: 'ironbody',
    relief: { shieldRestore: 0.5 },
    tendency: '同源功法易得 · 铁躯劫:护盾少减'
  },
  wood: {
    gongfaWeight: 2.2,
    fortuneWeight: 2.5,
    kind: 'counterflow',
    relief: { healRestore: 0.5 },
    tendency: '同源功法易得 · 逆流劫:恢复少减'
  },
  water: {
    gongfaWeight: 2.2,
    fortuneWeight: 2.5,
    kind: 'heavyrush',
    relief: { frontLoadEase: 0.35 },
    tendency: '同源功法易得 · 重压劫:起手减轻'
  },
  fire: {
    gongfaWeight: 2.2,
    fortuneWeight: 2.5,
    kind: 'soulrend',
    relief: { burstTierBonus: 1 },
    tendency: '同源功法易得 · 裂魂劫:爆发更能削劫'
  },
  earth: {
    gongfaWeight: 2.2,
    fortuneWeight: 2.5,
    kind: 'thunder',
    relief: { reductionToResist: 0.35 },
    tendency: '同源功法易得 · 雷鸣劫:天罚稍减'
  },
  wind: {
    gongfaWeight: 2.6,
    fortuneWeight: 2.8,
    kind: 'heavyrush',
    relief: { frontLoadEase: 0.4 },
    tendency: '同源功法易得 · 重压劫:起手减轻'
  },
  thunder: {
    gongfaWeight: 2.6,
    fortuneWeight: 2.8,
    kind: 'thunder',
    relief: { reductionToResist: 0.45 },
    tendency: '同源功法易得 · 雷鸣劫:天罚稍减'
  },
  ice: {
    gongfaWeight: 2.6,
    fortuneWeight: 2.8,
    kind: 'counterflow',
    relief: { healRestore: 0.4 },
    tendency: '同源功法易得 · 逆流劫:恢复少减'
  },
  light: {
    gongfaWeight: 2.6,
    fortuneWeight: 2.8,
    kind: 'soulrend',
    relief: { burstTierBonus: 1 },
    tendency: '同源功法易得 · 裂魂劫:爆发更能削劫'
  },
  dark: {
    gongfaWeight: 2.6,
    fortuneWeight: 2.8,
    kind: 'ironbody',
    relief: { shieldRestore: 0.45 },
    tendency: '同源功法易得 · 铁躯劫:护盾少减'
  },
  chaos: {
    gongfaWeight: 3.0,
    fortuneWeight: 3.2,
    kind: null,
    relief: { shieldRestore: 0.3, healRestore: 0.3, frontLoadEase: 0.22, burstTierBonus: 1, reductionToResist: 0.22 },
    tendency: '同源功法易得 · 五劫:皆稍缓解'
  }
}
