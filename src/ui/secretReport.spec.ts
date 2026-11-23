/**
 * 秘境战报时间线判据:战斗过程不能只剩一句「胜/负」,结算摘要也不能抢在过程前面。
 */
import { describe, expect, it } from 'vitest'
import type { CombatLogEntry } from '@/types'
import { secretReportRows } from './secretReport'

function log(t: CombatLogEntry['t'], text: string, dmg?: string, php = 1, ehp = 0.8): CombatLogEntry {
  return { t, side: 'p', text, dmg, php, ehp }
}

describe('秘境本层战报', () => {
  it('逐回合过程在前,层赏摘要在后,顺序与 fightSecretLayer 的回传一致', () => {
    const rows = secretReportRows(
      [log('atk', '你挥剑', '-120'), log('crit', '会心一击', '-360'), log('win', '战胜妖兽')],
      ['胜 妖兽 · 灵石 +1万', '悟道点 +3'],
      true
    )
    expect(rows.map(r => r.text)).toEqual([
      '你挥剑 -120',
      '会心一击 -360',
      '战胜妖兽',
      '胜 妖兽 · 灵石 +1万',
      '悟道点 +3'
    ])
    expect(rows[0]!.tone).toBe('text-ink-soft')
    expect(rows[1]!.tone).toBe('text-cinnabar')
    expect(rows[3]!.tone).toBe('text-gold-ink')
    expect(new Set(rows.map(r => r.id)).size).toBe(rows.length)
  })

  it('败场摘要用朱色;过程为空也保留摘要,不会把按钮门禁卡死', () => {
    const rows = secretReportRows([], ['不敌 妖兽 · 气血余 20%'], false)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.tone).toBe('text-cinnabar')
  })

  it('战斗行携带每回合敌我血量,摘要行不带(血条沿用最后一条战斗行读数)', () => {
    const rows = secretReportRows(
      [log('atk', '你挥剑', '-120', 0.9, 0.7), log('crit', '会心', '-360', 0.85, 0.2)],
      ['胜 妖兽 · 灵石 +1万'],
      true
    )
    expect(rows[0]!.php).toBe(0.9)
    expect(rows[0]!.ehp).toBe(0.7)
    expect(rows[1]!.php).toBe(0.85)
    expect(rows[1]!.ehp).toBe(0.2)
    // 摘要行没有血量字段,界面据此沿用最后一条战斗行,不被摘要把血条挪走
    expect(rows[2]!.php).toBeUndefined()
    expect(rows[2]!.ehp).toBeUndefined()
  })
})
