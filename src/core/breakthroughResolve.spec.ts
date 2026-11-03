/**
 * 服务端权威突破 —— 无头结算链的判据(src/core/breakthroughResolve 经 server 动态加载)。
 *
 * 客户端上传的修为/灵气只是「提议」:超出可信增量与容量的部分不采信;
 * 掷点与渡劫走 resolveBreakthroughOnStores(与客户端离线结算同一份代码);
 * 回传的 patches 只含被结算改动的顶层字段 —— 全量回灌会把 ≤20 秒前的旧值倒进客户端。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

let mockRand = 0
vi.mock('@/utils/random', async importOriginal => {
  const mod = await importOriginal<typeof import('@/utils/random')>()
  return { ...mod, rng: new mod.RandomService(() => mockRand) }
})

import { resolveBreakthroughFromSlices } from './breakthroughResolve'
import { toNum } from '@/utils/gnum'
import { BT_FAIL_EXP_LOSS } from '@/data/constants'

/** 一份「炼气·四层,修为圆满,灵气拉满」的可结算档(与 breakthroughFlow.spec 同一门槛口径) */
function readySave(): Record<string, unknown> {
  return {
    game: { started: true },
    player: { major: 0, sub: 3, exp: { m: 1, e: 12 } },
    resources: { qi: 999_999, spiritStone: { m: 1, e: 3 } },
    inventory: { items: [], pills: {} }
  }
}

const CTX = { elapsedSec: 60 }

describe('突破无头结算 · 门槛与形状', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockRand = 0
  })

  it('修为未满:ok=false,一分不动,patches 为空', () => {
    const data = readySave()
    ;(data.player as Record<string, unknown>).exp = { m: 0, e: 0 }
    const resolved = resolveBreakthroughFromSlices(data, {}, CTX)
    expect(resolved).not.toBeNull()
    expect(resolved!.outcome.ok).toBe(false)
    expect(resolved!.outcome.reason.length).toBeGreaterThan(0)
    expect(resolved!.patches).toEqual({})
    expect(resolved!.snapshot).toBeNull()
  })

  it('未开局 / 缺境界:拒绝结算(返回 null)', () => {
    const notStarted = readySave()
    notStarted.game = { started: false }
    expect(resolveBreakthroughFromSlices(notStarted, {}, CTX)).toBeNull()

    const noRealm = readySave()
    delete (noRealm.player as Record<string, unknown>).major
    expect(resolveBreakthroughFromSlices(noRealm, {}, CTX)).toBeNull()
  })
})

describe('突破无头结算 · 成功链路', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockRand = 0
  })

  it('成了:进一小层,patches 只含被改动的字段,快照境界随之抬升', () => {
    const resolved = resolveBreakthroughFromSlices(readySave(), {}, CTX)!
    expect(resolved.outcome.ok).toBe(true)
    expect(resolved.outcome.success).toBe(true)
    expect(resolved.outcome.fromMajor).toBe(0)
    expect(resolved.outcome.fromSub).toBe(3)
    expect(resolved.outcome.newMajor).toBe(0)
    expect(resolved.outcome.newSub).toBe(4)

    const player = resolved.patches.player ?? {}
    // diff 只含变更键:小进阶 major 不动(0→0),不该出现在补丁里
    expect(player.sub).toBe(4)
    expect(player.major).toBeUndefined()
    expect(player.exp, '突破扣掉这一境的需求,积余带走').toBeDefined()
    expect(toNum(player.exp as { m: number; e: number })).toBeLessThan(1e12)
    expect(resolved.patches.resources, '灵气按门槛扣了才对').toHaveProperty('qi')
    // 没有负伤、没准备:修为/灵气之外不该冒出无关分片
    expect(Object.keys(resolved.patches).every(k => ['player', 'resources', 'cultivation'].includes(k))).toBe(true)
    expect(resolved.snapshot?.realmIndex).toBe(4)
  })

  it('败了:境界不动,掉修为、添伤势,cultivation 补丁带伤 buff', () => {
    mockRand = 0.999
    const resolved = resolveBreakthroughFromSlices(readySave(), {}, CTX)!
    expect(resolved.outcome.ok).toBe(true)
    expect(resolved.outcome.success).toBe(false)
    expect(resolved.outcome.fromSub).toBe(3)
    expect(resolved.outcome.newSub).toBe(3)
    // diff 只含变更键:境界没动就不该冒出来
    expect(resolved.patches.player?.sub).toBeUndefined()
    expect(toNum(resolved.patches.player?.exp as { m: number; e: number })).toBeCloseTo(1e12 * (1 - BT_FAIL_EXP_LOSS), 0)
    const cultivation = resolved.patches.cultivation ?? {}
    const buffs = cultivation.buffs as Array<{ defId: string }> | undefined
    expect(buffs?.some(b => b.defId === 'injury'), '失败该留下伤势').toBe(true)
  })
})

describe('突破无头结算 · 上报值收口', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockRand = 0
  })

  it('上报天文修为:超出「存量 + 产出预算」的部分不采信,不靠它凑圆满', () => {
    const data = readySave()
    ;(data.player as Record<string, unknown>).exp = { m: 0, e: 0 }
    const resolved = resolveBreakthroughFromSlices(data, { exp: { m: 1, e: 500 } }, CTX)!
    // 60 秒窗口的预算远够不到炼气四层的需求:上报再大也过不了门槛
    expect(resolved.outcome.ok).toBe(false)
    expect(resolved.outcome.reason).toContain('修为')
  })

  it('上报天文灵气:按积余容量收口,照常结算', () => {
    const resolved = resolveBreakthroughFromSlices(readySave(), { qi: 1e15 }, CTX)!
    expect(resolved.outcome.ok).toBe(true)
    const qi = resolved.patches.resources?.qi as number | undefined
    expect(qi).toBeDefined()
    expect(qi!).toBeLessThanOrEqual(1e12)
  })

  it('上报修为低于存量(合法消耗):照采', () => {
    const data = readySave()
    ;(data.player as Record<string, unknown>).exp = { m: 5, e: 11 }
    const resolved = resolveBreakthroughFromSlices(data, { exp: { m: 1, e: 12 } }, CTX)!
    expect(resolved.outcome.ok).toBe(true)
    // 采信上报的 1e12(比存量 5e11 大且在预算内),进境后扣需求
    expect(toNum(resolved.patches.player?.exp as { m: number; e: number })).toBeLessThan(1e12)
  })
})
