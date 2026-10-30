import { describe, expect, it } from 'vitest'
import { BOSS_DIFFICULTY_OPTIONS, bossDifficultyOf, isBossDifficulty } from './bossDifficulty'

describe('围妖出剑难度档', () => {
  it('三档俱全,名字与倍率与服务端口径一致', () => {
    expect(BOSS_DIFFICULTY_OPTIONS.map(o => o.key)).toEqual(['calm', 'normal', 'peril'])
    expect(BOSS_DIFFICULTY_OPTIONS.map(o => o.name)).toEqual(['循境', '常探', '绝境'])
    expect(BOSS_DIFFICULTY_OPTIONS.map(o => o.atk)).toEqual([0.8, 1, 1.35])
    expect(BOSS_DIFFICULTY_OPTIONS.map(o => o.kill)).toEqual([1, 1.5, 2.5])
  })

  it('风险与回报同向:攻势越猛,赏格越厚', () => {
    for (let i = 1; i < BOSS_DIFFICULTY_OPTIONS.length; i++) {
      const prev = BOSS_DIFFICULTY_OPTIONS[i - 1]!
      const cur = BOSS_DIFFICULTY_OPTIONS[i]!
      expect(cur.atk).toBeGreaterThan(prev.atk)
      expect(cur.kill).toBeGreaterThan(prev.kill)
    }
  })

  it('文案里报得出倍率,玩家看得懂选的是什么', () => {
    for (const o of BOSS_DIFFICULTY_OPTIONS) {
      expect(o.desc).toContain(`×${o.atk}`)
      expect(o.desc).toContain(`击杀赏 ×${o.kill}`)
    }
  })

  it('宽松解析:脏值一律按常探,合法值原样通过', () => {
    expect(bossDifficultyOf('calm')).toBe('calm')
    expect(bossDifficultyOf('peril')).toBe('peril')
    expect(bossDifficultyOf('normal')).toBe('normal')
    expect(bossDifficultyOf('abyss')).toBe('normal')
    expect(bossDifficultyOf('')).toBe('normal')
    expect(bossDifficultyOf(42)).toBe('normal')
    expect(bossDifficultyOf(null)).toBe('normal')
  })

  it('isBossDifficulty 不认炼狱(围妖只有三档)', () => {
    expect(isBossDifficulty('abyss')).toBe(false)
    expect(isBossDifficulty('CALM')).toBe(false)
  })
})
