/** 流派组合技 —— 主副体系凑成特定搭配时激活,引擎按 comboArt 键触发 */

export interface ComboArtDef {
  id: string
  /** 参与组合的两个流派 id(不限主副次序) */
  pair: [string, string]
  name: string
  desc: string
  /** 结构性代价说明 */
  costText: string
}

export const COMBO_ARTS: ComboArtDef[] = [
  {
    id: 'xuangang',
    pair: ['gangdun', 'fanzhen'],
    name: '玄罡反震',
    desc: '护盾被击破的刹那,碎光化作一次强化反击(每场至多两次)',
    costText: '依赖护盾节奏,真伤之敌可绕过罡盾使其无从触发'
  },
  {
    id: 'kuze',
    pair: ['muze', 'beishui'],
    name: '枯泽回春',
    desc: '气血低于三成时,一切治疗增效五成',
    costText: '此时每次受疗,护盾亦随之消散一半——生机与灵光不可兼得'
  },
  {
    id: 'fenglian',
    pair: ['fengmang', 'lianji'],
    name: '锋连诀',
    desc: '满血会心必定衔接一记追击(每场限一次)',
    costText: '首伤之后锋芒顿减,机会只在开局一线'
  }
]

/** 依主副流派查激活的组合技(次序不限,副体系须足够成形) */
export function matchComboArt(primaryId: string, secondaryId: string | undefined): ComboArtDef | null {
  if (!secondaryId) return null
  return (
    COMBO_ARTS.find(
      art => (art.pair[0] === primaryId && art.pair[1] === secondaryId) || (art.pair[0] === secondaryId && art.pair[1] === primaryId)
    ) ?? null
  )
}

/** 组合技激活所需的副体系契合度 */
export const COMBO_SECONDARY_MIN = 0.45
