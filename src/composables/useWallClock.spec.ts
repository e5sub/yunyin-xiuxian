/**
 * 墙钟契约:暂停引擎时照常走,与 useGameClock 相反。
 * 组合式只是生命周期薄壳,本文件只钉 wallClock。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { wallClock } from './useWallClock'
import { setEnginePaused } from '@/core/enginePause'

describe('wallClock · 暂停时仍走墙钟', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('window', {
      setInterval: (cb: () => void, ms: number) => setInterval(cb, ms) as unknown as number,
      clearInterval: (id: number) => clearInterval(id)
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    setEnginePaused(false)
  })

  it('每 tick 调一次 cb', () => {
    const cb = vi.fn()
    const stop = wallClock(cb, 1000)
    vi.advanceTimersByTime(3500)
    expect(cb).toHaveBeenCalledTimes(3)
    stop()
  })

  it('引擎暂停时照常推进 —— 与 useGameClock 的冻结形成对照', () => {
    const cb = vi.fn()
    const stop = wallClock(cb, 1000)
    setEnginePaused(true)
    vi.advanceTimersByTime(5000)
    expect(cb, '墙钟域不该被暂停守卫冻住').toHaveBeenCalledTimes(5)
    setEnginePaused(false)
    vi.advanceTimersByTime(1000)
    expect(cb).toHaveBeenCalledTimes(6)
    stop()
  })

  it('stop() 收表:收后不再跑', () => {
    const cb = vi.fn()
    const stop = wallClock(cb, 1000)
    vi.advanceTimersByTime(1000)
    stop()
    vi.advanceTimersByTime(5000)
    expect(cb).toHaveBeenCalledTimes(1)
  })
})
