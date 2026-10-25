/**
 * 离线装备每场掉落概率与在线 afterWin 同吃 EQUIP_DROP_CHANCE_CAP(行为层)。
 * 期望件数 = 卷轴「另有 N 件折作器灵尘」的 N + 6;裸概率顶到 0.99 时仍须按 0.9 计。
 * 故障注入:把封顶从离线拿掉,N 按 0.99 算,本用例红。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { settleOffline } from './offline'
import { useGameStore } from '@/stores/game'
import { usePlayerStore } from '@/stores/player'
import { useAdventureStore } from '@/stores/adventure'
import { useDongfuStore } from '@/stores/dongfu'
import { useResourcesStore } from '@/stores/resources'
import { regionDef } from '@/data/regions'
import { avgDustPerDrop } from './economySim'
import { EXPLORE_BATTLE_INTERVAL } from '@/data/constants'

// rng 全响应固定,全链路确定
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

// 胜率固定 0.5,与模式难度解耦
vi.mock('./combat', async importOriginal => {
  const mod = await importOriginal<typeof import('./combat')>()
  return {
    ...mod,
    sampleWinRate: () => 0.5
  }
})

const SESSION_HOURS = 8

/** 读卷轴「另有 N 件折作器灵尘」的 N(= 期望件数 − 6) */
function overflowFromNotes(notes: string[]): number {
  const line = notes.find(n => n.includes('件折作器灵尘'))
  expect(line, `归来卷轴缺「另有 N 件折作器灵尘」一行,读不到期望件数:${notes.join(' | ')}`).toBeTruthy()
  return Number(/另有\s*(\d+)\s*件/.exec(line!)![1])
}

describe('离线装备掉落 · 每场概率吃在线那道封顶(行为层·确定性)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('裸概率越过 0.9 时,离线期望件数仍按 0.9 计(与在线 afterWin 同一封顶)', () => {
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
    player.addTalent('t_hongyun') // 鸿运:dropRate +0.1(裸概率 0.9 → 0.99)
    dongfu.setLevel('mansion', 8) // 离线封顶拉高,simSec 不被 dt 掐短
    // 商队遇袭:区域加丰 ×1.25,与 mode ×2.4 相乘后裸概率恰为 0.9
    player.setRegionEvent({ regionId: 'qingyun', eventId: 'shangdui', endsAt: Date.now() + 24 * 3600 * 1000 })
    adventure.setSession({
      regionId: 'qingyun',
      mode: 'prolonged',
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

    const summary = settleOffline(Date.now())!
    expect(summary.wins).toBeGreaterThan(100) // 场次够多,round 噪声可忽略

    const overflow = overflowFromNotes(summary.notes)
    const equipped = overflow + 6
    // 封顶 0.9;未挂福缘,doubleMult = 1
    expect(equipped, '离线期望件数未按 0.9 封顶(裸概率 0.99 直接乘了进去)').toBe(
      Math.round(summary.wins * 0.9)
    )
    // 防 0.99 与 0.9 恰好同 round
    expect(Math.round(summary.wins * 0.99)).not.toBe(Math.round(summary.wins * 0.9))
  })

  /**
   * 溢出件折尘按 avgDustPerDrop(tier),不按固定 4 尘;用 tier 32(avgDust≈77)验下界。
   * 故障注入:退回固定 4 尘,本用例红。
   */
  it('溢出件数折尘按 avgDustPerDrop(tier) 折算,高阶不再按固定 4 少付', () => {
    const game = useGameStore()
    const player = usePlayerStore()
    const adventure = useAdventureStore()
    const dongfu = useDongfuStore()
    game.markStarted()
    const started = Date.now() - SESSION_HOURS * 3600 * 1000
    game.lastActiveAt = started
    game.totalPlaySec = 60 * 60
    player.major = 20 // 混沌道祖,打得动高阶地界
    player.exp = { m: 0, e: 0 }
    dongfu.setLevel('mansion', 8)
    adventure.setSession({
      regionId: 'wudaoya', // 道祖悟道崖,tier 32
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

    const beforeDust = useResourcesStore().dust
    const summary = settleOffline(Date.now())!
    const dustGain = useResourcesStore().dust - beforeDust
    const overflow = overflowFromNotes(summary.notes)
    const tier = regionDef('wudaoya')!.tier
    const floor = Math.round(overflow * avgDustPerDrop(tier))
    expect(dustGain, `溢出折尘应 ≥ 溢出${overflow} × avgDustPerDrop(${tier})=${floor},不可退回固定 4`).toBeGreaterThanOrEqual(floor)
    // 防固定 4 恰好也过下界
    expect(dustGain).toBeGreaterThan(overflow * 6)
  })
})
