/** 修为 / 灵气积余:修为不封顶(积余随境界带走),灵气可积到标称容量的 QI_BANK_MULT 倍 */
import { beforeEach, describe, expect, it } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { usePlayerStore } from '@/stores/player'
import { useResourcesStore } from '@/stores/resources'
import { expRequirement } from './formulas'
import { QI_BANK_MULT } from '@/data/constants'
import { mulN, toNum } from '@/utils/gnum'

describe('修为积余(卡境不浪费)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('修为越过当前需求不被截断,进度封顶而积余保留', () => {
    const player = usePlayerStore()
    const req = player.expReq
    player.gainExp(mulN(req, 1.5))
    expect(player.expFull).toBe(true)
    expect(player.expProgress).toBe(1)
    expect(toNum(player.expOverflow) / toNum(req)).toBeCloseTo(0.5, 4)
    expect(toNum(player.exp) / toNum(req)).toBeCloseTo(1.5, 4)
  })

  it('突破只扣「刚走完的那一境」的需求,积余随境界带走', () => {
    const player = usePlayerStore()
    const req0 = expRequirement(0, 0)
    player.gainExp(mulN(req0, 1.5))
    player.advanceRealm() // 0 层 → 1 层(非大关)
    expect(player.sub).toBe(1)
    expect(toNum(player.exp) / toNum(req0)).toBeCloseTo(0.5, 4)
    expect(player.expReq).toEqual(expRequirement(0, 1))
  })

  it('卡在需求前也持续增长:两次累加不被中间的需求变化吞掉', () => {
    const player = usePlayerStore()
    const req = player.expReq
    player.gainExp(mulN(req, 0.25))
    player.gainExp(mulN(req, 0.25))
    expect(toNum(player.exp) / toNum(req)).toBeCloseTo(0.5, 4)
  })
})

describe('灵气积余(可存到标称容量的倍数)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('灵气可越过标称容量,上限为容量 × 积余倍数', () => {
    const player = usePlayerStore()
    const resources = useResourcesStore()
    const cap = player.qiCapValue
    expect(cap).toBeGreaterThan(0)

    resources.setQi(cap * 3, cap)
    expect(resources.qi).toBeCloseTo(cap * 3, 6)

    resources.setQi(cap * QI_BANK_MULT * 4, cap)
    expect(resources.qi).toBeCloseTo(cap * QI_BANK_MULT, 6)
  })

  it('灵气不会为负,也不会因积余而失去下限保护', () => {
    const player = usePlayerStore()
    const resources = useResourcesStore()
    resources.setQi(-100, player.qiCapValue)
    expect(resources.qi).toBe(0)
  })

  it('灵气积余上限对外可见 = 标称容量 × 积余倍数(界面据此显示)', () => {
    const player = usePlayerStore()
    expect(player.qiBankCapValue).toBeCloseTo(player.qiCapValue * QI_BANK_MULT, 6)
  })
})
