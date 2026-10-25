/**
 * 游戏时钟的暂停守卫:心跳停着(重置 / 导入确认)时冻结。
 * 守卫全在 gameClock,useGameClock 只是生命周期薄壳,本文件只钉 gameClock。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { gameClock } from './useGameClock'
import { setEnginePaused } from '@/core/enginePause'

describe('gameClock · 暂停冻结的游戏时钟', () => {
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
    // enginePause 是模块级单例,须复位
    setEnginePaused(false)
  })

  it('每 tick 调一次 cb', () => {
    const cb = vi.fn()
    const stop = gameClock(cb, 1000)
    vi.advanceTimersByTime(3500)
    expect(cb).toHaveBeenCalledTimes(3)
    stop()
  })

  it('心跳停着就冻结:cb 不跑;恢复后接着跑 —— 与 useNow 同一条口径', () => {
    const cb = vi.fn()
    const stop = gameClock(cb, 1000)
    vi.advanceTimersByTime(2000)
    expect(cb).toHaveBeenCalledTimes(2)
    setEnginePaused(true)
    vi.advanceTimersByTime(5000)
    expect(cb, '暂停期间一格都不该多跑').toHaveBeenCalledTimes(2)
    setEnginePaused(false)
    vi.advanceTimersByTime(2000)
    expect(cb, '恢复后照常走表').toHaveBeenCalledTimes(4)
    stop()
  })

  it('stop() 收表:收后不再跑', () => {
    const cb = vi.fn()
    const stop = gameClock(cb, 1000)
    vi.advanceTimersByTime(1000)
    stop()
    vi.advanceTimersByTime(5000)
    expect(cb).toHaveBeenCalledTimes(1)
  })
})
