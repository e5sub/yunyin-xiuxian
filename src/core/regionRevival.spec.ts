import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAdventureStore } from '@/stores/adventure'
import { usePlayerStore } from '@/stores/player'
import { useUiStore } from '@/stores/ui'
import { settleRegionRevivals } from './regionRevival'
import { settleSuppressedRegions } from './suppress'
import { regionBossCleared, winsUntilRegionBoss } from './exploration'
import { REGIONS } from '@/data/regions'
import { REVIVE_AFTER_HOURS } from './worldMemory'

const T0 = 1_000_000
const H = 3600_000

beforeEach(() => setActivePinia(createPinia()))
afterEach(() => vi.useRealTimers())

describe('妖气复聚(regionRevival)', () => {
  it('未靖平的地界无妖气可聚,不复聚', () => {
    const adventure = useAdventureStore()
    const id = REGIONS[0]!.id
    expect(adventure.cleared.includes(id)).toBe(false)
    expect(settleRegionRevivals(T0)).toEqual({ returned: [], loosened: [] })
    expect(adventure.revived).toEqual([])
  })

  it('已靖满 REVIVE_AFTER_HOURS 的地界旧主归来:不再已靖、进 revived', () => {
    vi.setSystemTime(T0)
    const adventure = useAdventureStore()
    const id = REGIONS[0]!.id
    adventure.markCleared(id) // 已靖起钟 = T0

    vi.setSystemTime(T0 + (REVIVE_AFTER_HOURS + 1) * H)
    const { returned } = settleRegionRevivals(Date.now())

    expect(returned).toContain(id)
    expect(adventure.cleared.includes(id)).toBe(false)
    expect(adventure.revived.includes(id)).toBe(true)
  })

  it('未满 REVIVE_AFTER_HOURS 不复聚', () => {
    vi.setSystemTime(T0)
    const adventure = useAdventureStore()
    const id = REGIONS[0]!.id
    adventure.markCleared(id)

    vi.setSystemTime(T0 + 1 * H)
    expect(settleRegionRevivals(Date.now())).toEqual({ returned: [], loosened: [] })
    expect(adventure.revived.includes(id)).toBe(false)
    expect(adventure.cleared.includes(id)).toBe(true)
  })

  it('旧主已归来的地界不重复复聚', () => {
    vi.setSystemTime(T0)
    const adventure = useAdventureStore()
    const id = REGIONS[0]!.id
    adventure.markCleared(id)
    vi.setSystemTime(T0 + (REVIVE_AFTER_HOURS + 1) * H)
    expect(settleRegionRevivals(Date.now()).returned).toContain(id)

    vi.setSystemTime(T0 + (REVIVE_AFTER_HOURS + 3) * H)
    expect(settleRegionRevivals(Date.now()).returned).toEqual([])
  })

  it('再靖一次即复位:revived 收掉,待下一次复聚', () => {
    vi.setSystemTime(T0)
    const adventure = useAdventureStore()
    const id = REGIONS[0]!.id
    adventure.markCleared(id)
    vi.setSystemTime(T0 + (REVIVE_AFTER_HOURS + 1) * H)
    settleRegionRevivals(Date.now())
    expect(adventure.revived.includes(id)).toBe(true)

    adventure.markCleared(id)
    expect(adventure.revived.includes(id)).toBe(false)
    expect(adventure.cleared.includes(id)).toBe(true)
  })

  it('近期镇压推迟旧主归来:已靖很久但刚镇压,未满 72h 不复聚', () => {
    vi.setSystemTime(T0)
    const adventure = useAdventureStore()
    const player = usePlayerStore()
    const id = REGIONS[0]!.id
    adventure.markCleared(id)
    const now = T0 + (REVIVE_AFTER_HOURS + 1) * H
    player.suppressedSince = { [id]: now - 1 * H }

    // touchedAt = max(clearedAt, suppressedSince)
    expect(settleRegionRevivals(now)).toEqual({ returned: [], loosened: [] })
    expect(adventure.revived.includes(id)).toBe(false)
    expect(adventure.cleared.includes(id)).toBe(true)
  })

  it('经 settleSuppressedRegions 接线:一份镇压都没有的已靖地界满钟也复聚(早退挡不住)', () => {
    vi.setSystemTime(T0)
    const adventure = useAdventureStore()
    const player = usePlayerStore()
    const id = REGIONS[0]!.id
    adventure.markCleared(id)
    vi.setSystemTime(T0 + (REVIVE_AFTER_HOURS + 1) * H)

    expect(player.suppressedRegions).toEqual([])
    settleSuppressedRegions(60) // 复聚在「无镇压直接返回」之前结算

    expect(adventure.revived.includes(id)).toBe(true)
    expect(adventure.cleared.includes(id)).toBe(false)
  })

  // 故障注入:把松闸那段搬回 suppress.ts 各弹一条 → 本条红
  it('已靖且镇压同时够钟:只报一条,旧主归来与镇压松开一并说清', () => {
    vi.setSystemTime(T0)
    const adventure = useAdventureStore()
    const player = usePlayerStore()
    const ui = useUiStore()
    const id = REGIONS[0]!.id
    adventure.markCleared(id)
    player.suppressedRegions = [id]
    player.suppressedSince = { [id]: T0 }

    vi.setSystemTime(T0 + (REVIVE_AFTER_HOURS + 1) * H)
    settleRegionRevivals(Date.now())

    expect(ui.toasts, '同一次复聚只该弹一条').toHaveLength(1)
    expect(ui.toasts[0]!.text).toContain('旧主归来')
    expect(ui.toasts[0]!.text).toContain('镇压松开')
    expect(player.suppressedRegions, '妖气都聚起来了,镇压该松').not.toContain(id)
    expect(adventure.revived).toContain(id)
    expect(adventure.cleared).not.toContain(id)
  })

  // 故障注入:松闸改回 isReviving(player.suppressedSince[...]) → 本条红
  it('镇压满 72h 但今天仍在那片战斗:不松闸(钟取最后一次打交道)', () => {
    const adventure = useAdventureStore()
    const player = usePlayerStore()
    const id = REGIONS[0]!.id
    const now = T0 + (REVIVE_AFTER_HOURS + 1) * H
    vi.setSystemTime(now)
    player.suppressedRegions = [id]
    player.suppressedSince = { [id]: T0 }
    player.regionStats[id] = {
      totalFights: 20,
      avgRounds: 2,
      avgDamageTakenPct: 0.05,
      consecutiveWins: 20,
      lastUpdateAt: now - 1 * H
    }

    expect(settleRegionRevivals(now)).toEqual({ returned: [], loosened: [] })
    expect(player.suppressedRegions, '还在守的地界不该被按旧时刻收掉').toContain(id)
    expect(adventure.revived).not.toContain(id)
  })

  /** markRevived 不动 mortalCleared(撤掉会把整条路线重新锁死);regionBossCleared 须自己补问 revived */
  it('复聚后首领判定转回未靖:路线内区域的本世节点仍通,也不再算「已靖」(首领复出)', () => {
    vi.setSystemTime(T0)
    const adventure = useAdventureStore()
    const regionId = 'qingyun'
    adventure.$patch({
      mortalWorld: {
        seed: 1, shapeId: 's', shapeName: 's', rhythmId: 'r', rhythmName: 'r', ruleId: 'r', ruleName: 'r', bias: 'b',
        chain: [{ nodeId: 'n1_qingyun', fromId: regionId, name: '青云山麓', tier: 1, enemies: [], boss: 'b', archetype: 'a', eventTags: [] }]
      } as never,
      cleared: [] as string[]
    } as never)
    adventure.markCleared(regionId)
    adventure.markNodeCleared('n1_qingyun')
    expect(regionBossCleared(regionId), '构型前提:首领已靖').toBe(true)
    expect(winsUntilRegionBoss(0, regionBossCleared(regionId))).toBeNull()

    vi.setSystemTime(T0 + (REVIVE_AFTER_HOURS + 1) * H)
    expect(settleRegionRevivals(Date.now()).returned).toContain(regionId)

    expect(adventure.mortalCleared, '路线节点照旧留着 —— 撤掉会把整条路线重新锁死').toContain('n1_qingyun')
    expect(regionBossCleared(regionId), '归来即不再已靖,首领该复出').toBe(false)
    expect(winsUntilRegionBoss(0, regionBossCleared(regionId)), '首领重新排队,不再是 null').not.toBeNull()
  })
})
