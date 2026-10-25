/** 洞府灵脉:一条主脉(70 点)+ 若干副脉(各 ≤30 点),总容量 100,不能全部点满 */
import type { StatMods } from '@/types'

export type VeinId = 'gather' | 'craft' | 'alchemy' | 'insight'

export interface VeinDef {
  id: VeinId
  name: string
  seal: string
  desc: string
  /** 每点带来的属性加成(悟道脉走参悟折扣,不在此表) */
  perPoint: StatMods
}

export const VEINS: VeinDef[] = [
  {
    id: 'gather',
    name: '青木灵脉',
    seal: '聚',
    desc: '修炼加速',
    perPoint: { cultivationSpeed: 0.004 }
  },
  {
    id: 'craft',
    name: '赤炎灵脉',
    seal: '炼',
    desc: '强化耗材更省',
    perPoint: { forgeDiscount: 0.003 }
  },
  {
    id: 'alchemy',
    name: '玉髓灵脉',
    seal: '丹',
    desc: '炉中常出双丹',
    perPoint: { alchemyYield: 0.005 }
  },
  {
    id: 'insight',
    name: '寒冥灵脉',
    seal: '悟',
    desc: '参悟功法所费更少',
    perPoint: {}
  }
]

/** 悟道脉每点参悟折扣 */
export const INSIGHT_DISCOUNT_PER_POINT = 0.004
/** 参悟省耗封顶:展示与结算共用(现满点 70 = 28%) */
export const INSIGHT_DISCOUNT_CAP = 0.5
/** 与投资卡「当前加成」同名 */
export const INSIGHT_EFFECT_NAME = '参悟省耗'

export function veinDef(id: VeinId): VeinDef {
  return VEINS.find(v => v.id === id)!
}
