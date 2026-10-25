/**
 * 天劫劫型:大境界突破前派生,确定性(种子:境界 + 今日天时)。
 * 每种劫型须有 ≥2 条互不相同的解法;spec 钉:core/tribulationSpace.spec.ts。
 */

export type TribulationKind = 'thunder' | 'counterflow' | 'soulrend' | 'ironbody' | 'heavyrush'

/** 波形:劫雷在各波之间如何分布 */
export type TribulationWaveShape =
  /** 均匀:按基础公式逐波递增 */
  | 'even'
  /** 前重后轻:起手数波重击,其后转缓 */
  | 'frontLoaded'

export interface TribulationDef {
  id: TribulationKind
  name: string
  seal: string
  /** 劫势一句话 */
  desc: string
  /**
   * 伤害公式修正,每项须被 core/tribulationDecision 真实读取(desc 写的机制须有数值落地):
   * dmgMult 单波伤害倍率 · healMult 治疗效率 · shieldMult 护盾效果倍率(后两项 1 = 正常)· waveShape 波次分布
   */
  dmgMult: number
  healMult: number
  shieldMult: number
  waveShape: TribulationWaveShape
}

export const TRIBULATIONS: TribulationDef[] = [
  {
    id: 'thunder',
    name: '雷鸣',
    seal: '雷',
    desc: '劫雷极重 · 护盾减效 · 恢复增效',
    dmgMult: 1.12,
    healMult: 1.1,
    shieldMult: 0.8,
    waveShape: 'even'
  },
  {
    id: 'counterflow',
    name: '逆流',
    seal: '流',
    desc: '恢复大减',
    dmgMult: 0.95,
    healMult: 0.65,
    shieldMult: 1,
    waveShape: 'even'
  },
  {
    id: 'soulrend',
    name: '裂魂',
    seal: '魂',
    desc: '护盾略增 · 爆发可削劫',
    dmgMult: 1.0,
    healMult: 1,
    shieldMult: 1.1,
    waveShape: 'even'
  },
  {
    id: 'ironbody',
    name: '铁躯',
    seal: '躯',
    desc: '护盾几乎无效 · 恢复增效',
    dmgMult: 0.9,
    healMult: 1.15,
    shieldMult: 0.45,
    waveShape: 'even'
  },
  {
    id: 'heavyrush',
    name: '重压',
    seal: '压',
    desc: '起手两击极重 · 其后转缓',
    dmgMult: 1.0,
    healMult: 1,
    shieldMult: 1.25,
    waveShape: 'frontLoaded'
  }
]

const BY_ID = new Map(TRIBULATIONS.map(t => [t.id, t]))

export function tribulationDef(id: TribulationKind): TribulationDef {
  return BY_ID.get(id) ?? TRIBULATIONS[0]!
}
