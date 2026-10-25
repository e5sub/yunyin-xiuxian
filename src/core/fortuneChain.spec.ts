/** 机缘链:选择记忆 → 影响未来 */
import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { recordFortuneChoice, mentorHint } from './fortuneChain'
import { usePlayerStore } from '@/stores/player'

describe('机缘链(fortuneChain)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('机缘选择被记录(取/弃)', () => {
    recordFortuneChoice('ft_sword_remnant', 'take')
    expect(usePlayerStore().fortuneChoices['ft_sword_remnant']).toBe('take')
  })

  it('剑痕取 → 推荐剑修师承', () => {
    recordFortuneChoice('ft_sword_remnant', 'take')
    expect(mentorHint()).toBe('swordsman')
  })

  it('妖兽认主 → 推荐猎修', () => {
    recordFortuneChoice('ft_beast_pledge', 'take')
    expect(mentorHint()).toBe('hunter')
  })

  it('弃过一次的机缘不产生推荐(leave 不算 take)', () => {
    recordFortuneChoice('ft_sword_remnant', 'leave')
    expect(mentorHint()).toBeNull()
    expect(usePlayerStore().fortuneChoices['ft_sword_remnant']).toBe('leave')
  })

  it('未遇机缘时无推荐', () => {
    expect(mentorHint()).toBeNull()
  })
})
