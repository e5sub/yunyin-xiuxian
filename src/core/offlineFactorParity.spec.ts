/**
 * 离线普通战产出吃区域加丰(妖潮 ×1.2)与福缘(t_tanbao doubleDropRate ×1.05)的行为层回归;文本契约见 offlineParity.spec。
 * rng 与 sampleWinRate 均 mock 成固定响应,残页产出只差一个因子;t_tanbao 的 dropRate 不进残页,故断言残页页数。
 * 断言用区间包住 Math.round 噪声:妖潮 [1.13, 1.27],福缘 [1.03, 1.09]。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { settleOffline } from './offline'
import { useGameStore } from '@/stores/game'
import { usePlayerStore } from '@/stores/player'
import { useAdventureStore } from '@/stores/adventure'
import { useResourcesStore } from '@/stores/resources'
import { useDongfuStore } from '@/stores/dongfu'
import { EXPLORE_BATTLE_INTERVAL } from '@/data/constants'

vi.mock('@/utils/random', async importOriginal => {
  const mod = await importOriginal<typeof import('@/utils/random')>()
  return {
    ...mod,
    rng: {
      next: () => 0.5,
      int: (a: number, _b: number) => a,
      float: (a: number, _b: number) => a,
      pick: <T,>(arr: readonly T[]): T => arr[0]!,
      weighted: <T,>(arr: readonly T[]): T => arr[0]!,
      chance: (): boolean => true
    }
  }
})

// 胜率固定 0.5:否则妖潮加难压低胜场、淹没加丰;危险耦合由 offlineScope/battleFactor 守
vi.mock('./combat', async importOriginal => {
  const mod = await importOriginal<typeof import('./combat')>()
  return {
    ...mod,
    sampleWinRate: () => 0.5
  }
})

const SESSION_HOURS = 8

interface FactorCase {
  regionEvent: boolean
  doubleDrop: boolean
}

/** 返回本次离线新增的残页页数 */
function runPage(core: FactorCase): number {
  setActivePinia(createPinia())
  const game = useGameStore()
  const player = usePlayerStore()
  const adventure = useAdventureStore()
  const dongfu = useDongfuStore()
  game.markStarted()
  const started = Date.now() - SESSION_HOURS * 3600 * 1000
  game.lastActiveAt = started
  game.totalPlaySec = 60 * 60 // 本日第 1 小时,避开跨天时序
  player.major = 2 // 筑基境,打得动一阶区域
  player.exp = { m: 0, e: 0 }
  if (core.doubleDrop) player.addTalent('t_tanbao') // 探宝:doubleDropRate +0.05
  dongfu.setLevel('mansion', 8) // 离线封顶拉高,simSec 不被 dt 掐短
  adventure.setSession({
    regionId: 'qingyun',
    mode: 'normal',
    startedAt: started,
    endsAt: started + 999 * 3600 * 1000,
    nextBattleAt: started + EXPLORE_BATTLE_INTERVAL * 1000,
    wins: 0,
    losses: 0,
    events: 0,
    stoneGain: { m: 0, e: 0 },
    expGain: { m: 0, e: 0 },
    itemGain: 0
  })
  if (core.regionEvent) {
    // 妖潮:加丰 ×1.2(加难 ×1.15 已被 sampleWinRate mock 按下)
    player.setRegionEvent({
      regionId: 'qingyun',
      eventId: 'yaochao',
      endsAt: Date.now() + 24 * 3600 * 1000
    })
  }
  const beforePage = useResourcesStore().page
  settleOffline(Date.now())
  return Math.max(0, useResourcesStore().page - beforePage)
}

describe('离线普通战产出吃区域加丰与福缘(行为层·确定性)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('妖潮区域事件加丰(×1.2):残页产出约为平日 1.2 倍(±取整噪声)', () => {
    const base = runPage({ regionEvent: false, doubleDrop: false })
    const yaochao = runPage({ regionEvent: true, doubleDrop: false })
    expect(base).toBeGreaterThan(0)
    expect(yaochao).toBeGreaterThanOrEqual(Math.round(base * 1.13))
    expect(yaochao).toBeLessThanOrEqual(Math.round(base * 1.27))
  })

  it('福缘 doubleDropRate(探宝 ×1.05):残页产出约为平日 1.05 倍(±取整噪声)', () => {
    const base = runPage({ regionEvent: false, doubleDrop: false })
    const talented = runPage({ regionEvent: false, doubleDrop: true })
    expect(base).toBeGreaterThan(0)
    expect(talented).toBeGreaterThanOrEqual(Math.round(base * 1.03))
    expect(talented).toBeLessThanOrEqual(Math.round(base * 1.09))
  })

  it('区域加丰与福缘彼此独立可叠加:妖潮+探宝 应显著高于任一单因子', () => {
    const both = runPage({ regionEvent: true, doubleDrop: true })
    const yaochao = runPage({ regionEvent: true, doubleDrop: false })
    const talented = runPage({ regionEvent: false, doubleDrop: true })
    expect(both).toBeGreaterThan(yaochao)
    expect(both).toBeGreaterThan(talented)
    // 组合 ≈ ×1.2×1.05:相对妖潮单因子再 ×1.05
    expect(both).toBeGreaterThanOrEqual(Math.round(yaochao * 1.03))
    expect(both).toBeLessThanOrEqual(Math.round(yaochao * 1.09))
  })
})
