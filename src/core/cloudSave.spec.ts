/**
 * 服务端 corrections 回传的客户端应用判据。
 *
 * 要守的三件事:
 *  1. 两段路径(player.exp)按顶层字段 patch,语义与 1.57.0 起一致;
 *  2. 三段路径(player.reincarnation.count/daoFruit/talents)以现对象为底合并 ——
 *     直接把标量/数组 patch 上去会把整个 reincarnation 对象顶掉,引擎每秒抛错,
 *     刷新后世号/道果/天赋/道侣履历全清(1.62.0 修复的毁档口);
 *  3. 底座已被毁成标量时不雪上加霜:先 sanitize 自愈,绝不把坏结构再往深里写。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { SAVE_SANITIZE_STEPS } from './saveSanitize'
import { applyAuthorityCorrections } from './cloudSave'
import { usePlayerStore } from '@/stores/player'

function withPinia<T>(fn: () => T): T {
  setActivePinia(createPinia())
  try {
    return fn()
  } finally {
    setActivePinia(undefined)
  }
}

function storeOf(slice: string): { $state: Record<string, unknown> } {
  const step = SAVE_SANITIZE_STEPS.find(s => s.slice === slice)
  if (step === undefined) throw new Error(`no sanitize step for slice ${slice}`)
  return step.use() as unknown as { $state: Record<string, unknown> }
}

describe('corrections 应用 · 两段路径', () => {
  it('顶层标量字段直接覆盖,其余字段不动', () => {
    withPinia(() => {
      const game = storeOf('game')
      const before = game.$state.totalPlaySec
      applyAuthorityCorrections([{ path: 'game.totalPlaySec', after: 12345 }])
      expect(game.$state.totalPlaySec).toBe(12345)
      // 同一 store 的其他字段不被波及
      expect(game.$state.started === undefined || typeof game.$state.started === 'boolean').toBe(true)
      expect(before).not.toBe(12345)
    })
  })
})

describe('corrections 应用 · 三段路径(转世对象)', () => {
  it('count 压回以现对象为底合并,reincarnation 其余键原样保留', () => {
    withPinia(() => {
      const player = storeOf('player')
      const before = { ...(player.$state.reincarnation as Record<string, unknown>) }
      expect(before.count).toBeDefined()
      applyAuthorityCorrections([{ path: 'player.reincarnation.count', after: 3 }])
      const after = player.$state.reincarnation as Record<string, unknown>
      expect(typeof after).toBe('object')
      expect(after.count).toBe(3)
      // 对象没被顶成数字:其余键(道果/天赋/宿命传承等)都还在
      for (const k of Object.keys(before)) {
        if (k === 'count') continue
        expect(after[k]).toEqual(before[k])
      }
    })
  })

  it('talents 压回同样合并,不会把对象顶成数组', () => {
    withPinia(() => {
      const player = storeOf('player')
      applyAuthorityCorrections([{ path: 'player.reincarnation.talents', after: [] }])
      const after = player.$state.reincarnation as Record<string, unknown>
      expect(typeof after).toBe('object')
      expect(Array.isArray(after)).toBe(false)
      expect(after.talents).toEqual([])
      expect(after.count).toBeDefined()
    })
  })

  it('底座已是坏结构(标量)时 sanitize 自愈,不再往坏结构里写', () => {
    withPinia(() => {
      const player = usePlayerStore() as unknown as {
        $state: Record<string, unknown>
        sanitize: () => void
      }
      // 模拟被 1.61.0 前旧代码毁掉的状态:reincarnation 被顶成了数字
      player.$state.reincarnation = 2 as unknown as typeof player.$state.reincarnation
      expect(() => applyAuthorityCorrections([{ path: 'player.reincarnation.count', after: 5 }])).not.toThrow()
      // sanitize 自愈后 reincarnation 恢复对象形态(世界默认值),count 不会被写进标量
      expect(typeof player.$state.reincarnation).toBe('object')
      expect((player.$state.reincarnation as Record<string, unknown>).count).not.toBe(5)
    })
  })

  it('走 store 实例(usePlayerStore)与走分片注册表拿到的 reincarnation 同源', () => {
    withPinia(() => {
      const viaStep = storeOf('player').$state.reincarnation
      const viaStore = (usePlayerStore() as unknown as { $state: Record<string, unknown> }).$state.reincarnation
      expect(viaStep).toEqual(viaStore)
    })
  })
})

describe('corrections 应用 · 防御', () => {
  it('未知分片与畸形路径一律跳过,不抛错', () => {
    withPinia(() => {
      expect(() =>
        applyAuthorityCorrections([
          { path: 'unknownSlice.field', after: 1 },
          { path: 'player', after: 2 },
          { path: 'player.', after: 3 },
          { path: '', after: 4 }
        ])
      ).not.toThrow()
    })
  })
})

/**
 * 写档 429 源头治理(1.79.7):服务端 PUT /save 限速 2s,而客户端有六处触发
 * (定时器/启动/开局 watch/visibilitychange/pagehide/失败重试),切窗时 2s 内扎堆
 * 就撞限速刷红 429。纯网游下偏好三片幂等可丢,故用「指纹跳过 + 节流闸门」两道闸。
 * 这些闸依赖模块内的可变状态与 localStorage,难在单测里跑完整 push 流程;
 * 这里以源码 Walking 判据钉住两道闸的**顺序与守卫条件**,防被无意删改/调换。
 */
describe('写档 429 治理 · 两道跳过闸(1.79.7)', () => {
  const src = readFileSync(resolve(__dirname, './cloudSave.ts'), 'utf-8')

  it('节流间隔 > 服务端 2s 限速,留抖动余量', () => {
    const m = /const PUSH_MIN_GAP_MS = ([\d_]+)/.exec(src)
    expect(m, '找不到 PUSH_MIN_GAP_MS').not.toBeNull()
    const ms = Number(m![1]!.replace(/_/g, ''))
    expect(ms, '节流必须宽于服务端 WRITE_MIN_GAP_MS=2000,否则仍会撞 429').toBeGreaterThan(2000)
    expect(ms, '留太多余量会让真实偏好变更久久传不上去').toBeLessThanOrEqual(5000)
  })

  it('指纹跳过与节流都在「非首传且非手动」的守卫内', () => {
    expect(src, '偏好指纹跳过必须在').toMatch(/if \(!firstBuild && !manual\) \{[\s\S]{0,300}fingerprint === lastPrefFingerprint[\s\S]{0,120}skipped-unchanged/)
    expect(src, '节流闸门与指纹跳过同一守卫,首传建档不受影响').toMatch(
      /fingerprint === lastPrefFingerprint\)\s*return 'skipped-unchanged'[\s\S]{0,120}Date\.now\(\) - lastPutAt < PUSH_MIN_GAP_MS\)\s*return 'skipped-throttled'/
    )
  })

  it('指纹只在成功落库后记录,失败不记(下次触发会重发)', () => {
    const okIdx = src.indexOf("if (!firstBuild && !manual) lastPrefFingerprint = JSON.stringify(payload.data)")
    const putIdx = src.indexOf('await cloudApi.putSave(')
    expect(okIdx, '找不到成功后的指纹记录').toBeGreaterThan(0)
    expect(putIdx, '找不到 putSave 调用').toBeGreaterThan(0)
    expect(okIdx, '指纹记录必须在 PUT 之后:失败不记,下一次触发会重发').toBeGreaterThan(putIdx)
  })

  it('lastPutAt 记在发出 PUT 之前,与服务端「无论成败都计时」同口径', () => {
    const stampIdx = src.indexOf('lastPutAt = Date.now()')
    const putIdx = src.indexOf('await cloudApi.putSave(')
    expect(stampIdx, '找不到 lastPutAt 落戳').toBeGreaterThan(0)
    expect(stampIdx, '落戳须在 PUT 之前,否则两次请求都看旧戳会连发').toBeLessThan(putIdx)
  })
})
