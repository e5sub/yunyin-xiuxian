/** 玩家身份裁判:画像只来自真实道痕;节点只记首次;纪录方向正确;叙事不给赏罚 */
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { DaoMark } from '@/types'
import { gn } from '@/utils/gnum'
import { cultivatorProfile, daoNarrative, MILESTONE_DEFS } from './identity'
import { useEndgameStore } from '@/stores/endgame'

function mark(partial: Partial<DaoMark>): DaoMark {
  return {
    life: 1,
    daoPathId: 'slaughter',
    targetId: 'chiyan',
    targetName: '赤炎天',
    cleared: true,
    rounds: 40,
    buildName: '背水·反震',
    powerText: '1',
    at: Date.now(),
    replay: {
      mods: {},
      attack: gn(100),
      defense: gn(55),
      maxHp: gn(1400),
      speed: 1,
      skills: [],
      artifacts: [],
      pactId: 'ni'
    },
    ...partial
  }
}

describe('修行画像', () => {
  it('样本不足不成像;足量后统计与评价可复现', () => {
    expect(cultivatorProfile([mark({}), mark({})])).toBeNull()
    const marks = [
      mark({ at: 1 }),
      mark({ at: 2 }),
      mark({ at: 3, cleared: false }),
      mark({ at: 4, targetId: 'wanren', targetName: '万刃天' }),
      mark({ at: 5, targetId: 'wanren', targetName: '万刃天' }),
      mark({ at: 6, targetId: 'wanren', targetName: '万刃天' })
    ]
    const p = cultivatorProfile(marks)!
    expect(p).not.toBeNull()
    expect(p.daoShares[0]!.name).toBe('杀伐道')
    expect(p.riskText).toBe('高')
    expect(p.favoriteBuild).toBe('背水·反震')
    expect(p.verdict.length).toBeGreaterThan(0)
    // 万刃 3 胜 0 负
    expect(p.bestWorld).toBe('万刃天')
  })
})

describe('修行节点与纪录', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('节点只记首次;纪录按方向刷新', () => {
    const endgame = useEndgameStore()
    expect(endgame.addMilestone('first_world', 3)).toBe(true)
    expect(endgame.addMilestone('first_world', 9)).toBe(false)
    expect(endgame.milestones[0]!.life).toBe(3)

    expect(endgame.updateRecord('fastest_world', 60, 3, '赤炎天', 'min')).toBe(true)
    expect(endgame.updateRecord('fastest_world', 80, 4, '万刃天', 'min')).toBe(false)
    expect(endgame.updateRecord('fastest_world', 41, 5, '无生天', 'min')).toBe(true)
    expect(endgame.records['fastest_world']!.value).toBe(41)
  })

  it('全部节点定义有名有述', () => {
    for (const def of MILESTONE_DEFS) {
      expect(def.name.length).toBeGreaterThan(0)
      expect(def.desc.length).toBeGreaterThan(0)
    }
  })
})

describe('道途行为叙事', () => {
  it('叙事只是文字,且随行为不同而不同', () => {
    const pure = [mark({ life: 7, buildName: '罡盾流' }), mark({ life: 7, buildName: '罡盾流' })]
    const messy = [
      mark({ life: 7, buildName: '罡盾流' }),
      mark({ life: 7, buildName: '背水·反震' }),
      mark({ life: 7, buildName: '锋芒·连击' })
    ]
    const a = daoNarrative('sword', pure, 7)
    const b = daoNarrative('sword', messy, 7)
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    expect(a).not.toBe(b)
    // 样本不足不语
    expect(daoNarrative('sword', [mark({ life: 7 })], 7)).toBeNull()
  })
})
