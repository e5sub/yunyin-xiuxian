/**
 * 天劫计数口径:成就 a_trib3 的计数只在渡劫成功时 +1。
 * 裸装 炼气→筑基(4 波天雷)最小伤害抖动下稳过(余量 ≈+0.21)、最大下稳败,故钉死 rng 即定成败。
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { attemptBreakthrough } from './breakthrough'
import { usePlayerStore } from '@/stores/player'
import { useResourcesStore } from '@/stores/resources'
import { useQuestsStore } from '@/stores/quests'

/** rng 的固定返回:0 → float 取最小伤害(≈×0.85),1 → 最大伤害(≈×1.15) */
let mockTribRand = 0.5
vi.mock('@/utils/random', async importOriginal => {
  const mod = await importOriginal<typeof import('@/utils/random')>()
  return { ...mod, rng: new mod.RandomService(() => mockTribRand) }
})

/** 炼气·十层 圆满,修为/灵气拉满,只差渡劫 */
function atTribeGate(): void {
  const player = usePlayerStore()
  const resources = useResourcesStore()
  player.$patch({ major: 0, sub: 9, exp: { m: 1e12, e: 0 } })
  resources.$patch({ qi: 999_999 })
}

describe('突破 · 天劫计数口径', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockTribRand = 0.5
  })

  it('渡劫失败不计数:连败不该解锁「渡过 3 次天劫」', () => {
    mockTribRand = 1 // 必败
    const quests = useQuestsStore()
    for (let i = 0; i < 3; i += 1) {
      atTribeGate() // 失败掉修为,重试前回补
      const view = attemptBreakthrough()
      expect(view?.success).toBe(false)
      expect(quests.counter('tribulations')).toBe(0)
    }
  })

  it('渡劫成功才计数:每渡一劫 +1,为「劫后余生」攒进度', () => {
    mockTribRand = 0 // 必过
    atTribeGate()
    const quests = useQuestsStore()
    const player = usePlayerStore()
    const view = attemptBreakthrough()
    expect(view?.success).toBe(true)
    expect(player.major).toBe(1)
    expect(quests.counter('tribulations')).toBe(1)
  })
})
