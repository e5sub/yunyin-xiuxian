/**
 * 动作结算的服务端权威链 —— 判据(src/core/actionOps 经 server/vendor 动态加载)。
 *
 * 服务端拿云档分片无头水合 17 片,跑**客户端同一份结算代码**,只把改动的顶层键回传。
 * 判据四件事:
 *   · 形状门槛(未开局 / 缺境界 / 时间非法)返回 null,调用方据此拒绝;
 *   · 动作本身失败(囊中无此丹)返回 ok=false **且空补丁** —— 客户端那次预测须整体作废;
 *   · 成功的动作,补丁里必须真的带上被改的键(否则客户端不知道要覆盖什么);
 *   · 补丁不含「水合噪声」:什么都没做的键不该出现在补丁里。
 */
import { describe, expect, it, vi } from 'vitest'

const mockRand = 0.5
vi.mock('@/utils/random', async importOriginal => {
  const mod = await importOriginal<typeof import('@/utils/random')>()
  return { ...mod, rng: new mod.RandomService(() => mockRand) }
})

import { resolveActionFromSlices } from './actionOps'
import { toNum } from '@/utils/gnum'

const NOW = 1_700_000_000_000

/** 一份「炼气一层、囊中两枚聚气丹、百枚玄铁」的最小档;缺的分片按 store 默认值水合 */
function save(): Record<string, unknown> {
  return {
    game: { started: true, totalPlaySec: 600, lastActiveAt: NOW - 10_000 },
    player: { major: 0, sub: 0, exp: { m: 0, e: 0 }, age: 16, dead: false },
    resources: {
      spiritStone: { m: 1, e: 4 },
      qi: 10,
      ore: 100,
      page: 0,
      dust: 0,
      wudao: 0,
      herbByGrade: { 1: 100, 2: 0, 3: 0, 4: 0, 5: 0 }
    },
    inventory: { pills: { p_jvqidan: 2 }, items: [] },
    endgame: { daoSource: 0 }
  }
}

describe('动作结算 · 形状门槛', () => {
  it('未开局 / 缺境界 / 时刻非法:返回 null(服务端事故,不是玩家反馈)', async () => {
    const notStarted = save()
    notStarted.game = { started: false }
    await expect(resolveActionFromSlices(notStarted, { kind: 'pill_use', id: 'p_jvqidan' }, { now: NOW })).resolves.toBeNull()

    const noRealm = save()
    delete (noRealm.player as Record<string, unknown>).major
    await expect(resolveActionFromSlices(noRealm, { kind: 'pill_use', id: 'p_jvqidan' }, { now: NOW })).resolves.toBeNull()

    await expect(resolveActionFromSlices(save(), { kind: 'pill_use' }, { now: 0 })).resolves.toBeNull()
  })

  it('未知动作:ok=false 且空补丁', async () => {
    const r = await resolveActionFromSlices(save(), { kind: 'not_a_kind' }, { now: NOW })
    expect(r).not.toBeNull()
    expect(r!.ok).toBe(false)
    expect(r!.patches).toEqual({})
  })
})

describe('动作结算 · 丹药', () => {
  it('服一枚聚气丹:修为涨、丹少一枚,补丁带上这两处', async () => {
    const r = await resolveActionFromSlices(save(), { kind: 'pill_use', id: 'p_jvqidan' }, { now: NOW })
    expect(r!.ok).toBe(true)
    const pills = r!.patches.inventory?.pills as Record<string, number> | undefined
    expect(pills, '补丁要带行囊').toBeDefined()
    expect(pills!.p_jvqidan).toBe(1)
    const exp = r!.patches.player?.exp as { m: number; e: number } | undefined
    expect(exp, '补丁要带修为').toBeDefined()
    expect(toNum(exp!)).toBeGreaterThan(0)
  })

  it('囊中无此丹:ok=false,一处补丁都不回(客户端预测整体作废)', async () => {
    const empty = save()
    empty.inventory = { pills: {}, items: [] }
    const r = await resolveActionFromSlices(empty, { kind: 'pill_use', id: 'p_jvqidan' }, { now: NOW })
    expect(r!.ok).toBe(false)
    expect(r!.patches).toEqual({})
    expect(typeof r!.reason).toBe('string')
  })

  it('连服两枚:按枚数一次结清(count 不采信超出持有)', async () => {
    const r = await resolveActionFromSlices(save(), { kind: 'pill_use', id: 'p_jvqidan', count: 2 }, { now: NOW })
    expect(r!.ok).toBe(true)
    const pills = r!.patches.inventory?.pills as Record<string, number> | undefined
    // 两枚吃光:store 在归零时会删键,补丁里看到的要么是 0 要么是缺键
    expect(pills?.p_jvqidan ?? 0).toBe(0)
  })
})

describe('动作结算 · 坊市与资源', () => {
  it('卖一份玄铁:灵石涨、玄铁少,补丁两处都在', async () => {
    const r = await resolveActionFromSlices(save(), { kind: 'sell_material' }, { now: NOW })
    expect(r!.ok).toBe(true)
    const ore = r!.patches.resources?.ore as number | undefined
    expect(ore, '玄铁要被扣').toBeDefined()
    expect(ore!).toBeLessThan(100)
    const stone = r!.patches.resources?.spiritStone as { m: number; e: number } | undefined
    expect(stone, '灵石要入账').toBeDefined()
    expect(toNum(stone!)).toBeGreaterThan(1e4)
  })

  it('没有可卖之物时 ok=false', async () => {
    const broke = save()
    ;(broke.resources as Record<string, unknown>).ore = 0
    const r = await resolveActionFromSlices(broke, { kind: 'sell_material' }, { now: NOW })
    expect(r!.ok).toBe(false)
    expect(r!.patches).toEqual({})
  })
})

describe('动作结算 · 补丁不含噪声', () => {
  it('卖玄铁的补丁里不该出现与动作无关的分片', async () => {
    const r = await resolveActionFromSlices(save(), { kind: 'sell_material' }, { now: NOW })
    const slices = Object.keys(r!.patches)
    // 坊市卖出只动资源;行囊/角色/任务一概不该被这次动作改写
    expect(slices).toEqual(['resources'])
  })
})
