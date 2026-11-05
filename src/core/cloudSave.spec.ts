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
