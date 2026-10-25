/** 可冻结倒计时读数与到期结算共用 `gameNow()`;读真实墙钟会先跑到 0、恢复后又跳回 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { gameNow, setEnginePaused } from '@/core/enginePause'

const clock = vi.hoisted(() => ({ tick: null as null | (() => void) }))

vi.mock('./useGameClock', () => ({
  useGameClock: (cb: () => void) => {
    clock.tick = cb
  }
}))

import { useNow } from './useNow'

describe('useNow · 读数随游戏时钟冻结', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    clock.tick = null
    setEnginePaused(false)
  })

  afterEach(() => {
    setEnginePaused(false)
    vi.useRealTimers()
  })

  it('暂停时读数冻住,恢复后与 gameNow 同步', () => {
    const now = useNow()
    vi.advanceTimersByTime(1000)
    clock.tick!()
    expect(now.value).toBe(gameNow())

    setEnginePaused(true)
    const frozen = now.value
    vi.advanceTimersByTime(10_000)
    clock.tick!()
    expect(now.value, '暂停时倒计时不该继续往下跑').toBe(frozen)

    setEnginePaused(false)
    vi.advanceTimersByTime(1000)
    clock.tick!()
    expect(now.value).toBe(gameNow())
  })
})
