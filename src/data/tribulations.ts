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
    desc: '雷劫爆发极高,雷光之下护体灵光形同虚设。所幸雷息之间尚容调息,能疗伤者可撑。',
    dmgMult: 1.12,
    healMult: 1.1,
    shieldMult: 0.8,
    waveShape: 'even'
  },
  {
    id: 'counterflow',
    name: '逆流',
    seal: '流',
    desc: '劫中灵气逆乱,治疗恢复效果大减。久战者需另寻生路。',
    dmgMult: 0.95,
    healMult: 0.65,
    shieldMult: 1,
    waveShape: 'even'
  },
  {
    id: 'soulrend',
    name: '裂魂',
    seal: '魂',
    desc: '劫雷直撼神魂,唯守中带稳者能从容。攻势足者可硬生生削去几分劫威。',
    dmgMult: 1.0,
    healMult: 1,
    shieldMult: 1.1,
    waveShape: 'even'
  },
  {
    id: 'ironbody',
    name: '铁躯',
    seal: '躯',
    desc: '劫雷沉重绵密,层层碾落。护体灵光在这等钝压下几乎撑不住,唯绵长疗伤者可熬。',
    dmgMult: 0.9,
    healMult: 1.15,
    shieldMult: 0.45,
    waveShape: 'even'
  },
  {
    id: 'heavyrush',
    name: '重压',
    seal: '压',
    desc: '起手两击雷霆万钧,其后转缓。若首轮护持不及,一切休提。',
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
