/**
 * 宿命传承:kind='legacy' 永久项(同 daoFruit / talents),跨世不清零;门槛金丹..真仙,金丹以下锻造不出。
 * 红线(heritageForge.spec / heritageEffects.spec 结构断言):不得声明为攻防 / 修速 / 战力倍率;
 * 效果只落有界、平直的能力位,不随道果或世数增长。
 * 锻造生命周期在 core/heritageForge.ts,效果实现在 core/heritageEffects.ts;此处只定义传承、门槛、效果轴。
 * 跨世去留另在 core/samsaraAudit 的 HERITAGE 表登记(kind='legacy', mode='full')。
 */
export interface HeritageDef {
  id: string
  name: string
  /** 境界门槛 2..9:本世达到该境界才可锻造 */
  gateMajor: number
  /** 有界平直的能力位,禁止随世缩放的百分数效果 */
  effect: 'bounded-flat'
  /** 效果轴:选择 / 容错 / 荣誉 */
  axis: 'choice' | 'fault-tolerant' | 'honor'
  /** 玩家向文案(参与红线扫描) */
  desc: string
  /** 机制侧描述(参与红线扫描) */
  effectDesc: string
}

export type HeritageId = string

/** 基线六道传承;增删须守「有界平直 + 非倍率 + 金丹以下锻造不出」 */
export const HERITAGE_DEFS: HeritageDef[] = [
  {
    id: 'danxin',
    name: '浴火丹心',
    gateMajor: 2,
    effect: 'bounded-flat',
    axis: 'fault-tolerant',
    desc: '转世开局,本世前三炉炼丹必成',
    effectDesc: '出生后本世前三炉开炉必定成丹(新手手感,不炼也不亏,用量每世不续)'
  },
  {
    id: 'yuanying',
    name: '元婴凝实',
    gateMajor: 3,
    effect: 'bounded-flat',
    axis: 'honor',
    desc: '转世起始境界,保底从筑基起,而非炼气',
    effectDesc: '出生时起始境界不低于筑基(major 抬一档,尊重;只此一档,不随世徒增)'
  },
  {
    id: 'tonggan',
    name: '炼虚通感',
    gateMajor: 5,
    effect: 'bounded-flat',
    axis: 'choice',
    desc: '转世择先天之姿时,多一个可选项',
    effectDesc: '转世的三选一变为四选一(多一份选择,不白给任何属性)'
  },
  {
    id: 'daotong',
    name: '大乘道统',
    gateMajor: 7,
    effect: 'bounded-flat',
    axis: 'honor',
    desc: '转世时,已习功法等级不再折回起手',
    effectDesc: '转世交割按原等级带走各门已习功法(本作默认折回一层,此为平直保留)'
  },
  {
    id: 'dubu',
    name: '渡劫跬步',
    gateMajor: 8,
    effect: 'bounded-flat',
    axis: 'fault-tolerant',
    desc: '本世唯一一次突破失败,不散其修为',
    effectDesc: '每世唯一一次突破失败时,豁免修为折损(一次性容错,每世只此一回)'
  },
  {
    id: 'daoben',
    name: '真仙道痕',
    gateMajor: 9,
    effect: 'bounded-flat',
    axis: 'honor',
    desc: '转世睁眼,即认得世间所有灵材,不按境界补认知',
    effectDesc: '出生时认知按最高档全带,不因本世境界受限(平直开放,非增减数值)'
  }
]

const BY_ID: Record<string, HeritageDef> = Object.fromEntries(HERITAGE_DEFS.map(d => [d.id, d]))

export function heritageDef(id: string): HeritageDef | undefined {
  return BY_ID[id]
}
