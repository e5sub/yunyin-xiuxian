/**
 * 师承:一条方向性理念(一条轻词条 + 一条叙事),不是职业;与流派/道途/功法混合,不封任何构筑。
 * 师尊按实际行为评价(只叙事,无惩罚)。
 */
import type { StatMods } from '@/types'

export type MentorId = 'swordsman' | 'alchemist' | 'arraymaster' | 'hunter'

export interface MentorDef {
  id: MentorId
  name: string
  /** 师承名号 */
  title: string
  /** 擅长方向一句话 */
  desc: string
  /** 师承理念词条(轻量,并入 finalStats.mods) */
  mods: StatMods
  /** 行为叙事模板:{trait} 为长期行为特征 */
  narrative: {
    /** 契合(行为与师承一致) */
    aligned: string
    /** 未纯(行为相左) */
    unaligned: string
  }
  /** 师尊名 */
  master: string
}

export const MENTORS: MentorDef[] = [
  {
    id: 'swordsman',
    name: '剑修',
    title: '一剑破万法',
    desc: '锋芒更利,暴击更易',
    mods: { critRate: 0.03, damageBonus: 0.02 },
    narrative: {
      aligned: '师尊抚剑而笑:「剑心渐明,锋芒初露。」',
      unaligned: '师尊摇头:「剑意未纯。你心中有剑,手里却无剑。」'
    },
    master: '青松剑叟'
  },
  {
    id: 'alchemist',
    name: '丹修',
    title: '草木通神',
    desc: '回合间回气,炉中更易出丹',
    mods: { regenPerRound: 0.01, alchemyYield: 0.05 },
    narrative: {
      aligned: '师尊捻须:「丹道亦是道,你已得其味。」',
      unaligned: '师尊叹曰:「丹炉蒙尘久矣。你求的是药,还是力?」'
    },
    master: '百草婆婆'
  },
  {
    id: 'arraymaster',
    name: '阵修',
    title: '定鼎乾坤',
    desc: '开战便有护盾,受击更轻',
    mods: { shieldOnStart: 0.03, damageReduction: 0.02 },
    narrative: {
      aligned: '师尊抚阵纹:「以阵护道,此心甚稳。」',
      unaligned: '师尊蹙眉:「阵脚虚浮。守不住,何谈困敌?」'
    },
    master: '玄机子'
  },
  {
    id: 'hunter',
    name: '猎修',
    title: '踏遍山河',
    desc: '赶路更快,所得更多',
    mods: { explorationSpeed: 0.04, dropRate: 0.03 },
    narrative: {
      aligned: '师尊拍肩:「行万里路,猎万兽。你正是猎修的苗子。」',
      unaligned: '师尊远望:「你足不出户,也配称猎?」'
    },
    master: '哮天翁'
  }
]

const BY_ID = new Map(MENTORS.map(m => [m.id, m]))

export function mentorDef(id: MentorId): MentorDef | undefined {
  return BY_ID.get(id)
}
