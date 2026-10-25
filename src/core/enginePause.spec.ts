/** 心跳暂停的墙上时钟:钉冻结、幂等、恢复三条契约 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enginePaused, gameNow, pauseElapsedMs, setEnginePaused } from './enginePause'

const at = (iso: string) => vi.setSystemTime(new Date(iso))

describe('心跳暂停 · 墙上时钟冻在暂停那一刻', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setEnginePaused(false)
    at('2026-01-01T00:00:00Z')
  })

  afterEach(() => {
    setEnginePaused(false)
    vi.useRealTimers()
  })

  it('未暂停:gameNow 跟真实时钟走,pauseElapsedMs 恒为 0', () => {
    expect(enginePaused.value).toBe(false)
    const t0 = gameNow()
    at('2026-01-01T00:00:10Z')
    expect(gameNow()).toBe(t0 + 10_000)
    expect(pauseElapsedMs()).toBe(0)
  })

  it('暂停后:gameNow 冻在暂停那一刻,真实时间再走也不动', () => {
    at('2026-01-01T00:00:05Z')
    setEnginePaused(true)
    const frozen = gameNow()
    expect(enginePaused.value).toBe(true)
    at('2026-01-01T01:00:00Z')
    expect(gameNow()).toBe(frozen)
  })

  it('暂停中重复 setEnginePaused(true) 不重置冻结点(幂等)', () => {
    at('2026-01-01T00:00:05Z')
    setEnginePaused(true)
    const frozen = gameNow()
    at('2026-01-01T00:00:30Z')
    setEnginePaused(true)
    expect(gameNow()).toBe(frozen)
  })

  it('pauseElapsedMs:暂停中按传入 now 计,早于冻结点时夹回 0', () => {
    at('2026-01-01T00:00:05Z')
    setEnginePaused(true)
    expect(pauseElapsedMs(gameNow() + 4_000)).toBe(4_000)
    expect(pauseElapsedMs(gameNow() - 1_000)).toBe(0)
  })

  it('恢复后:gameNow 回到真实时钟,pauseElapsedMs 归 0', () => {
    setEnginePaused(true)
    at('2026-01-01T02:00:00Z')
    setEnginePaused(false)
    expect(enginePaused.value).toBe(false)
    expect(pauseElapsedMs()).toBe(0)
    expect(gameNow()).toBe(Date.now())
  })
})
