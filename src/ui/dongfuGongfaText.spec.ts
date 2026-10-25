import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  buildingActLabel,
  buildingDoneToast,
  buildingMansionGateToast,
  buildingPeakToast,
  buildingRealmGate,
  buildingShortReason,
  buildingShortToast
} from './buildingText'
import {
  gongfaAllLearnedToast,
  gongfaComprehendToast,
  gongfaPageShortToast,
  gongfaSubFullToast,
  gongfaUpDoneToast,
  gongfaUpShortToast
} from './gongfaText'

describe('洞府与功法提示 · 文言仍报清层数与材料', () => {
  it('营造拒因报清境界与缺口,不说升至', () => {
    expect(buildingRealmGate('筑基')).toBe('需筑基境')
    expect(buildingPeakToast()).toBe('已圆满')
    expect(buildingMansionGateToast()).toBe('辖于洞府')
    expect(buildingShortToast()).toContain('灵石')
    expect(buildingShortToast()).toContain('玄铁')
    expect(buildingShortToast()).toBe('灵石或玄铁不足')
    expect(buildingShortReason('stone', '12', 0)).toBe('灵石尚差 12')
    expect(buildingShortReason('ore', '0', 3)).toBe('玄铁尚差 3 块')
    expect(buildingShortReason('both', '12', 3)).toBe('灵石尚差 12 · 玄铁尚差 3 块')
    expect(buildingShortToast('stone', '12', 0)).toBe('灵石尚差 12')
    expect(buildingShortToast('ore', '0', 3)).not.toContain('灵石')
    expect(buildingShortToast('both', '12', 3)).toContain('玄铁尚差 3 块')
    expect(buildingDoneToast('丹房', 4)).toBe('「丹房」已至 4 级')
    expect(buildingDoneToast('丹房', 4)).not.toContain('升至')
    expect(buildingActLabel(0)).toBe('起造')
    expect(buildingActLabel(3)).toBe('再营')
  })

  it('参悟与精进仍报残页、悟道点与层数', () => {
    expect(gongfaPageShortToast()).toContain('残页')
    expect(gongfaPageShortToast()).toBe('残页不足')
    expect(gongfaPageShortToast(7)).toContain('残页尚差 7 页')
    expect(gongfaAllLearnedToast()).toBe('此境已收全')
    expect(gongfaComprehendToast('太玄引气诀')).toContain('《太玄引气诀》')
    expect(gongfaUpShortToast('wudao')).toContain('悟道点')
    expect(gongfaUpShortToast('wudao')).not.toContain('残页')
    expect(gongfaUpShortToast('page')).toContain('残页')
    expect(gongfaUpShortToast('page')).not.toContain('悟道点')
    expect(gongfaUpShortToast('both')).toContain('悟道点')
    expect(gongfaUpShortToast('both')).toContain('残页')
    expect(gongfaUpShortToast('wudao', { wudao: 4 })).toContain('悟道点尚差 4')
    expect(gongfaUpShortToast('page', { page: 6 })).toContain('残页尚差 6 页')
    expect(gongfaUpShortToast('both', { wudao: 4, page: 6 })).toContain('悟道点尚差 4 · 残页尚差 6 页')
    expect(gongfaUpDoneToast('太玄引气诀', 3)).toBe('《太玄引气诀》已至第 3 层')
    expect(gongfaSubFullToast(2)).toContain('2 席')
    expect(gongfaSubFullToast(2)).not.toContain('升级')
  })
})

describe('洞府卡片按钮与提示同源', () => {
  it('可营时写起造或再营,不写升级建造', () => {
    const card = readFileSync(new URL('../components/dongfu/BuildingCard.vue', import.meta.url), 'utf8')
    expect(card).toContain('buildingActLabel(')
    expect(card).not.toMatch(/level > 0 \? '升级' : '建造'/)
  })
})
