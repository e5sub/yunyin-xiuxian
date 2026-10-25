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
    tendency: '锋锐外显,剑器之属亲近你;铁躯钝压之下,护体灵光仍立得住'
  },
  wood: {
    gongfaWeight: 2.2,
    fortuneWeight: 2.5,
    kind: 'counterflow',
    relief: { healRestore: 0.5 },
    tendency: '生机绵长,草木丹方亲近你;灵气逆乱之中,你的生机不易断绝'
  },
  water: {
    gongfaWeight: 2.2,
    fortuneWeight: 2.5,
    kind: 'heavyrush',
    relief: { frontLoadEase: 0.35 },
    tendency: '柔而不折,水行之法亲近你;重压当头,你懂得以柔卸力'
  },
  fire: {
    gongfaWeight: 2.2,
    fortuneWeight: 2.5,
    kind: 'soulrend',
    relief: { burstTierBonus: 1 },
    tendency: '气性刚烈,炎法亲近你;裂魂劫下,你的攻势更能削去劫威'
  },
  earth: {
    gongfaWeight: 2.2,
    fortuneWeight: 2.5,
    kind: 'thunder',
    relief: { reductionToResist: 0.35 },
    tendency: '厚重载物,土行之法亲近你;雷鸣加身,厚土可分担几分天罚'
  },
  wind: {
    gongfaWeight: 2.6,
    fortuneWeight: 2.8,
    kind: 'heavyrush',
    relief: { frontLoadEase: 0.4 },
    tendency: '身法飘忽,风行之法亲近你;重压起手,你避得开最锋利的那一击'
  },
  thunder: {
    gongfaWeight: 2.6,
    fortuneWeight: 2.8,
    kind: 'thunder',
    relief: { reductionToResist: 0.45 },
    tendency: '同源引雷,雷法亲近你;天雷之下,你比旁人多懂几分雷性'
  },
  ice: {
    gongfaWeight: 2.6,
    fortuneWeight: 2.8,
    kind: 'counterflow',
    relief: { healRestore: 0.4 },
    tendency: '冰封灵台,冰法亲近你;灵气逆乱时,你的心神反而更定'
  },
  light: {
    gongfaWeight: 2.6,
    fortuneWeight: 2.8,
    kind: 'soulrend',
    relief: { burstTierBonus: 1 },
    tendency: '神魂光耀,光法亲近你;裂魂之劫难撼你的神台'
  },
  dark: {
    gongfaWeight: 2.6,
    fortuneWeight: 2.8,
    kind: 'ironbody',
    relief: { shieldRestore: 0.45 },
    tendency: '幽微难测,暗法亲近你;钝压绵密,你自有一层看不见的遮护'
  },
  chaos: {
    gongfaWeight: 3.0,
    fortuneWeight: 3.2,
    kind: null,
    relief: { shieldRestore: 0.3, healRestore: 0.3, frontLoadEase: 0.22, burstTierBonus: 1, reductionToResist: 0.22 },
    tendency: '万法归一,诸道皆亲;五劫之下俱有一线生机,却无一门登峰造极'
  }
}
