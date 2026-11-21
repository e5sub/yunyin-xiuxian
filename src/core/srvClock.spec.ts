/**
 * 服务端时钟对齐(srvClock)的口径钉:估计公式 / 钳幅 / 未校钟口径不变。
 * 背景:历练节拍戳两端各写一半(开局本机钟、开打后服务端钟),服务端按它自己的钟
 * 判开打 —— 本机钟快 S 秒,每场战斗就晚 S 秒;催拍 2.2 秒一拍空转两三拍 ≈ 5 秒,
 * 即玩家报的「倒计时归零后干等约 5 秒」。校钟后催拍与倒计时都按服务端钟域比较。
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { noteSrvClock, srvNow, srvOffsetMs, resetSrvClock } from './srvClock'

describe('srvClock 服务端时钟对齐', () => {
  beforeEach(() => {
    resetSrvClock()
    vi.useFakeTimers()
    vi.setSystemTime(Date.now())
  })

  it('未校钟时与墙钟同值:单机口径不变', () => {
    expect(srvOffsetMs()).toBe(0)
    expect(srvNow()).toBe(Date.now())
  })

  it('回包校钟:估计 = srvNow + 半程RTT − 本机收包时刻', () => {
    const t0 = Date.now()
    vi.setSystemTime(t0 + 100) // 本机收包时刻
    // 服务端组包 t0+2000,RTT 400ms → est = 2000 + 200 − 100 = +2100
    noteSrvClock(t0 + 2000, 400)
    expect(srvOffsetMs()).toBe(2100)
    expect(srvNow()).toBe(t0 + 100 + 2100)
  })

  it('钟差超钳幅的回包不采纳:估计维持原值', () => {
    noteSrvClock(Date.now() + 500_000, 0)
    expect(srvOffsetMs()).toBe(0)
  })

  it('非有限 / 非正 / 非数值 srvNow 一律不采纳', () => {
    noteSrvClock(Number.NaN, 0)
    noteSrvClock(0, 0)
    noteSrvClock(-5, 0)
    noteSrvClock('123' as unknown as number, 0)
    expect(srvOffsetMs()).toBe(0)
  })

  it('RTT 天文数字(断网重连首拍)按上界钳半程', () => {
    const t0 = Date.now()
    vi.setSystemTime(t0)
    // half = min(60s, 10s)/2 = 5s → est = t0 + 5000 − t0 = +5000
    noteSrvClock(t0, 60_000)
    expect(srvOffsetMs()).toBe(5000)
  })

  it('负钟差(本机快于服务端)同样可校', () => {
    noteSrvClock(Date.now() - 3000, 0)
    expect(srvOffsetMs()).toBe(-3000)
    expect(srvNow()).toBe(Date.now() - 3000)
  })
})
