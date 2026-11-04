import { describe, expect, it } from 'vitest'
import type { BossStrikeResult, DungeonBossReport } from '@/services/cloud'
import {
  bossAfterText,
  bossBadgeText,
  bossBarWidth,
  bossHpText,
  bossStrikeView,
  dungeonBossView,
  dungeonShareTail,
  hpSharePct,
  type BossStatusView
} from '@/ui/bossStatus'

function view(patch: Partial<BossStatusView> = {}): BossStatusView {
  return {
    name: '合体心魔',
    hpStart: '3.6万',
    hpLeft: '1.2万',
    leftPct: 33,
    killed: false,
    roundText: '第 12/12 轮',
    ...patch
  }
}

describe('首领战况文案', () => {
  it('未破:徽章报出剩余百分比,血条按剩余占比', () => {
    const v = view()
    expect(bossBadgeText(v)).toBe('未破 · 余 33%')
    expect(bossBarWidth(v)).toBe(33)
    expect(bossHpText(v)).toBe('余 1.2万 / 起初 3.6万')
  })

  it('已破:徽章写明,血条归零(不画成满血让人误读)', () => {
    const v = view({ killed: true, hpLeft: '0', leftPct: 0 })
    expect(bossBadgeText(v)).toBe('已击破')
    expect(bossBarWidth(v)).toBe(0)
    expect(bossHpText(v)).toBe('余 0 / 起初 3.6万')
  })

  it('脏百分比不把血条画出界:负值与超百夹回 0~100', () => {
    expect(bossBarWidth(view({ leftPct: -20 }))).toBe(0)
    expect(bossBarWidth(view({ leftPct: 180 }))).toBe(100)
  })

  it('战后一句:破没破、剩多少,一句话说完', () => {
    expect(bossAfterText(view())).toBe('气血 1.2万 / 3.6万(余 33%)')
    expect(bossAfterText(view({ killed: true, hpLeft: '0', leftPct: 0 }))).toBe('已击破(起初气血 3.6万)')
  })
})

describe('剩余占比(两页同一套口径)', () => {
  it('同量级按比值算,四舍五入到整数', () => {
    expect(hpSharePct({ m: 4, e: 3 }, { m: 8, e: 3 })).toBe(50)
    expect(hpSharePct({ m: 1, e: 4 }, { m: 3, e: 4 })).toBe(33)
  })

  it('差三个数量级以上按满/空计,不算出天文百分比', () => {
    expect(hpSharePct({ m: 1, e: 40 }, { m: 1, e: 3 })).toBe(100)
    expect(hpSharePct({ m: 1, e: 3 }, { m: 1, e: 40 })).toBe(0)
  })

  it('满血归零的边界:分母为零视为已空,不抛 NaN', () => {
    expect(hpSharePct({ m: 0, e: 0 }, { m: 0, e: 0 })).toBe(0)
    expect(hpSharePct({ m: 0, e: 0 }, { m: 5, e: 6 })).toBe(0)
  })
})

describe('两侧视图折算', () => {
  it('副本:轮次按服务端口径(斗法数轮、守卫数波)', () => {
    const base: DungeonBossReport = {
      name: '合体心魔',
      hpStart: '3.6万',
      hpLeft: '1.2万',
      leftPct: 33,
      killed: false,
      rounds: 12,
      roundsTotal: 12,
      unit: 'round'
    }
    expect(dungeonBossView(base).roundText).toBe('第 12/12 轮')
    expect(dungeonBossView({ ...base, unit: 'wave', rounds: 6, roundsTotal: 9 }).roundText).toBe('第 6/9 波')
    expect(dungeonBossView(base).name).toBe('合体心魔')
  })

  it('围妖:十回合连斩不报轮次,气血按 GNum 折成与页面同口径的文本', () => {
    const strike: BossStrikeResult = {
      damage: { m: 2, e: 4 },
      damageText: '2万',
      rounds: 10,
      fell: false,
      killed: false,
      hp: { m: 6, e: 4 },
      maxHp: { m: 1, e: 5 },
      bossName: '妖王·饕餮',
      tier: 3,
      reward: { stone: 0, herb: 0 },
      difficulty: 'normal',
      difficultyName: '常探',
      recipients: 0,
      equipWinner: null
    }
    const v = bossStrikeView(strike)
    expect(v.name).toBe('妖王·饕餮')
    expect(v.leftPct).toBe(60)
    expect(v.roundText, '固定十回合,轮次不另报').toBe('')
    expect(v.hpLeft).toBe('6万')
    expect(v.hpStart).toBe('10万')
  })

  it('围妖击杀:余血归零,不采信服务端可能残留的 hp 值', () => {
    const v = bossStrikeView({
      damage: { m: 1, e: 5 },
      damageText: '10万',
      rounds: 10,
      fell: false,
      killed: true,
      hp: { m: 9, e: 3 },
      maxHp: { m: 1, e: 5 },
      bossName: '妖王·饕餮',
      tier: 3,
      reward: { stone: 0, herb: 0 },
      difficulty: 'normal',
      difficultyName: '常探',
      recipients: 3,
      equipWinner: '某某'
    })
    expect(v.killed).toBe(true)
    expect(v.hpLeft).toBe('0')
    expect(v.leftPct).toBe(0)
  })
})

describe('道友提示尾巴', () => {
  it('有没有破压进半句里;无首领(共修大阵)与老服务端为空', () => {
    const base: DungeonBossReport = {
      name: '合体心魔',
      hpStart: '3.6万',
      hpLeft: '1.2万',
      leftPct: 33,
      killed: false,
      rounds: 12,
      roundsTotal: 12,
      unit: 'round'
    }
    expect(dungeonShareTail(base)).toBe(' · 合体心魔余 33%')
    expect(dungeonShareTail({ ...base, killed: true })).toBe(' · 合体心魔已破')
    expect(dungeonShareTail(null)).toBe('')
    expect(dungeonShareTail(undefined)).toBe('')
  })
})
