import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HERITAGE, heritageGroups } from '@/core/samsaraAudit'
import { heritageViewRows, rebirthDecisionHint } from './rebirthText'

describe('rebirthDecisionHint', () => {
  it('matches carryGongfa: levels return to 1, artifacts are not kept', () => {
    const text = rebirthDecisionHint()
    expect(HERITAGE.find(r => r.id === 'artifacts')?.mode).toBe('reset')
    expect(HERITAGE.find(r => r.id === 'gongfa')?.mode).toBe('partial')
    expect(text).toContain('一层')
    expect(text).toContain('法宝')
    expect(text).not.toContain('折半')
    expect(text).not.toMatch(/保留[^。]*法宝/)
  })

  it('the character sheet uses the shared hint, not a second summary', () => {
    const src = readFileSync(resolve(__dirname, '../components/character/RebirthDialog.vue'), 'utf8')
    expect(src).toContain('rebirthDecisionHint()')
    expect(src).not.toContain('功法折半')
  })

  it('兵解门槛的境名不手抄:toast 与弹窗一样读 MANUAL_REBIRTH_MIN_MAJOR', () => {
    const src = readFileSync(resolve(__dirname, '../components/character/RebirthDialog.vue'), 'utf8')
    expect(src).toContain('REALMS[MANUAL_REBIRTH_MIN_MAJOR]?.name')
    expect(src).not.toContain('至少金丹境方可自行兵解')
    expect(src).not.toContain('兵解需金丹境')
  })
})

describe('heritageViewRows 去留一览(与 HERITAGE 同表)', () => {
  it('逐行对应:一条 HERITAGE 一行,名号一致,留/去与 mode 同义', () => {
    const rows = heritageViewRows()
    expect(rows.length).toBe(HERITAGE.length)
    for (const r of HERITAGE) {
      const row = rows.find(x => x.id === r.id)
      expect(row).toBeDefined()
      expect(row!.name).toBe(r.name)
      expect(row!.mode).toBe(r.mode)
    }
  })

  it('措辞三态:保留/部分保留/归零各自成词,保留一色、归零灰', () => {
    const rows = heritageViewRows()
    expect(rows.find(r => r.id === 'daoFruit')!.modeLabel).toBe('保留')
    expect(rows.find(r => r.id === 'daoFruit')!.cls).toBe('text-jade')
    expect(rows.find(r => r.id === 'gongfa')!.modeLabel).toBe('部分保留')
    expect(rows.find(r => r.id === 'realm')!.modeLabel).toBe('归零')
    expect(rows.find(r => r.id === 'realm')!.cls).toBe('text-ink-faint')
  })

  it('兵解前一览与结算弹窗的分组同一套去留用词', () => {
    const titles = new Map(heritageGroups().map(g => [g.mode, g.title]))
    for (const row of heritageViewRows()) expect(row.modeLabel, row.id).toBe(titles.get(row.mode))
  })
})
