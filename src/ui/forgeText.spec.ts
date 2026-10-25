import { describe, expect, it } from 'vitest'
import {
  artifactBatchDoneToast,
  artifactBatchInterruptedToast,
  artifactCapToast,
  artifactDoneToast,
  artifactShortToast,
  batchDecomposeToast,
  decomposeToast,
  salvageYieldText,
  upgradeBatchDoneToast,
  upgradeCapToast,
  upgradeDoneToast,
  upgradeShortToast
} from './forgeText'

describe('炼器提示 · 只报结果,仍报清尘与石', () => {
  it('强化到顶、料不足、成功,三句各说一件事', () => {
    expect(upgradeCapToast()).toBe('强化已至上限')
    expect(upgradeShortToast('dust')).toContain('器灵尘')
    expect(upgradeShortToast('dust')).not.toContain('灵石')
    expect(upgradeShortToast('stone')).toContain('灵石')
    expect(upgradeShortToast('stone')).not.toContain('器灵尘')
    // 只报差额,不附来处
    expect(upgradeShortToast('dust')).not.toContain('分解')
    expect(upgradeShortToast('stone')).not.toContain('历练')
    expect(upgradeShortToast('stone', { stone: '7', dust: 0 })).toBe('灵石尚差 7')
    expect(upgradeShortToast('dust', { stone: '0', dust: 2 })).toBe('器灵尘尚差 2')
    // 无差额时与全仓同词「X不足」
    expect(upgradeShortToast('dust')).toBe('器灵尘不足')
    expect(upgradeDoneToast('玄铁剑', 3)).toBe('「玄铁剑」已至 +3')
  })

  it('连升只报一次总况:级数、现阶、尘、石都在', () => {
    expect(upgradeBatchDoneToast(3, 4, 60, '120')).toBe('连升 3 级至 +4 · 共耗器灵尘×60 · 灵石 120')
    expect(upgradeBatchDoneToast(1, 1, 10, '0')).toContain('连升 1 级')
  })

  it('分解单件与批量都报器灵尘,有石才提退还', () => {
    expect(decomposeToast(12)).toBe('已化尘 · 得器灵尘×12')
    expect(decomposeToast(12, '1.2万', '八成')).toContain('灵石退还 1.2万(八成)')
    expect(salvageYieldText(4)).toBe('器灵尘×4')
    expect(batchDecomposeToast(3, salvageYieldText(9))).toBe('已化尘 3 件 · 得器灵尘×9')
  })

  it('法宝祭炼不叫炼化', () => {
    expect(artifactCapToast()).toBe('祭炼已至上限')
    expect(artifactDoneToast('紫电')).toContain('祭炼')
    expect(artifactDoneToast('紫电')).not.toContain('炼化')
  })

  it('祭炼缺料分得清悟道点与灵石,提示不再两头都说', () => {
    expect(artifactShortToast('wudao')).toContain('悟道点')
    expect(artifactShortToast('wudao')).not.toContain('灵石')
    expect(artifactShortToast('stone')).toContain('灵石')
    expect(artifactShortToast('stone')).not.toContain('悟道点')
    // 只报差额,不附来处
    expect(artifactShortToast('wudao')).not.toContain('藏经阁')
    expect(artifactShortToast('stone')).not.toContain('历练')
    expect(artifactShortToast('wudao', { wudao: 2, stone: '0' })).toBe('悟道点尚差 2')
    expect(artifactShortToast('stone', { wudao: 0, stone: '7' })).toBe('灵石尚差 7')
    expect(artifactShortToast('wudao')).toBe('悟道点不足')
  })

  it('祭炼连升只报一次总况:重数、现重、悟道、石都在', () => {
    expect(artifactBatchDoneToast(3, 5, 32, '240')).toBe('连炼 3 重至第 5 重 · 共耗悟道×32 · 灵石 240')
    expect(artifactBatchInterruptedToast(1, 3, 8, '60')).toBe('连炼 1 重即止 · 至第 3 重 · 实耗悟道×8 · 灵石 60')
  })
})
