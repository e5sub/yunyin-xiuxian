/**
 * 每日活动托管(core/autoOps 的 autoDailyTick)的取舍与边界:
 *   一 非 VIP 概不动手,开关到期自动关停;
 *   二 擂台只在未达标时代打,达标即领,已领绝不重复领;
 *   三 闲趣只做观星与垂钓(竿竿钓满才收篓,空篓不收),猜谜一概不代答;
 *   四 一日办妥后不再空跑接口(换日/换号才重新核)。
 * 云接口整体替身:托管只认「服务端怎么回」,不认界面怎么显示。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { DailyEventView, EventToday, LeisureReward, LeisureToday } from '@/services/cloud'

const cloud = vi.hoisted(() => ({
  eventToday: vi.fn(),
  eventClaim: vi.fn(),
  eventArena: vi.fn(),
  leisureToday: vi.fn(),
  leisureStar: vi.fn(),
  leisureCast: vi.fn(),
  leisureClaimBasket: vi.fn(),
  leisureAnswer: vi.fn()
}))

vi.mock('@/services/cloud', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/cloud')>()),
  cloudApi: cloud
}))

import { autoDailyTick, stopAutoOps } from './autoOps'
import { useAuthStore } from '@/stores/auth'
import { useGameStore } from '@/stores/game'
import { useResourcesStore } from '@/stores/resources'
import { useSettingsStore } from '@/stores/settings'

const DAY = '2026-11-03'

const ZERO: LeisureReward = { stone: 0, herb: 0, wudao: 0, ore: 0, dust: 0, page: 0 }
const R = (v: Partial<LeisureReward> = {}): LeisureReward => ({ ...ZERO, ...v })

function eventView(over: Partial<DailyEventView> = {}): DailyEventView {
  return {
    id: 'e_tue_arena',
    dow: 2,
    name: '试剑台',
    tag: '试剑',
    desc: '',
    kind: 'arena',
    target: 3,
    rule: '',
    reward: R({ stone: 180, dust: 30 }),
    to: '/event',
    ...over
  }
}

function eventToday(over: Partial<EventToday> = {}): EventToday {
  return {
    enabled: true,
    day: DAY,
    now: 0,
    secsToNext: 3600,
    event: eventView(),
    mine: { progress: 0, claimed: false },
    rank: null,
    week: [],
    ...over
  }
}

function leisureToday(over: Partial<LeisureToday> = {}): LeisureToday {
  return {
    enabled: true,
    day: DAY,
    now: 0,
    secsToNext: 3600,
    star: { drawn: true, fortune: null },
    fish: { casts: 3, max: 3, basket: R(), caught: [], claimed: true },
    riddle: { q: '', options: ['甲', '乙', '丙', '丁'], answered: false, correct: null, note: null },
    ...over
  }
}

/** 登录且置成 VIP/非 VIP:auth 的 loggedIn/isVip 是 computed,只能从 token/userId/vipUntil 播种 */
function signIn(vip: boolean): void {
  const auth = useAuthStore()
  auth.token = 'tk'
  auth.userId = 7
  auth.vipUntil = vip ? Date.now() + 86_400_000 : 0
  useGameStore().started = true
}

beforeEach(() => {
  setActivePinia(createPinia())
  // 模块级的当日备忘随循环停启归零,否则上一个用例「已办妥」会让这一轮的 tick 直接跳过
  stopAutoOps()
  for (const fn of Object.values(cloud)) fn.mockReset()
  useSettingsStore().autoDailyEvent = true
})

describe('每日活动托管的边界', () => {
  it('未登录一概不动手', async () => {
    useGameStore().started = true
    await autoDailyTick()
    expect(cloud.eventToday).not.toHaveBeenCalled()
  })

  it('非 VIP 不动手,开关到期自动关停', async () => {
    signIn(false)
    await autoDailyTick()
    expect(cloud.eventToday).not.toHaveBeenCalled()
    expect(useSettingsStore().autoDailyEvent).toBe(false)
  })

  it('没开这个开关就只当没这回事', async () => {
    signIn(true)
    useSettingsStore().autoDailyEvent = false
    await autoDailyTick()
    expect(cloud.eventToday).not.toHaveBeenCalled()
  })
})

describe('周天七会', () => {
  it('擂台未达标则代连战,达标即领,赏入账', async () => {
    signIn(true)
    cloud.eventToday
      .mockResolvedValueOnce(eventToday())
      .mockResolvedValueOnce(eventToday({ mine: { progress: 3, claimed: false } }))
    cloud.eventArena.mockResolvedValue({
      day: DAY,
      eventId: 'e_tue_arena',
      runs: [],
      streak: 3,
      target: 3,
      mine: { progress: 3, claimed: false }
    })
    cloud.eventClaim.mockResolvedValue({ reward: R({ stone: 180, dust: 30 }), day: DAY, eventId: 'e_tue_arena' })
    cloud.leisureToday.mockResolvedValue(leisureToday())

    await autoDailyTick()

    expect(cloud.eventArena).toHaveBeenCalledTimes(1)
    expect(cloud.eventClaim).toHaveBeenCalledTimes(1)
    const res = useResourcesStore()
    expect(res.spiritStone.m).toBeGreaterThan(0)
    expect(res.dust).toBe(30)
  })

  it('今日已领便不再上台也不再领', async () => {
    signIn(true)
    cloud.eventToday.mockResolvedValue(eventToday({ mine: { progress: 3, claimed: true } }))
    cloud.leisureToday.mockResolvedValue(leisureToday())

    await autoDailyTick()

    expect(cloud.eventArena).not.toHaveBeenCalled()
    expect(cloud.eventClaim).not.toHaveBeenCalled()
  })

  it('天榜未入前五十只等不领;入榜才领', async () => {
    signIn(true)
    const board = eventView({ id: 'e_sun_board', dow: 7, kind: 'board', target: 50 })
    cloud.eventToday.mockResolvedValue(eventToday({ event: board, rank: 88 }))
    cloud.leisureToday.mockResolvedValue(leisureToday())
    await autoDailyTick()
    expect(cloud.eventClaim).not.toHaveBeenCalled()

    // 名次进前五十:同一天再核一遍(上一轮未办妥,备忘不曾置位)
    cloud.eventToday.mockResolvedValue(eventToday({ event: board, rank: 12 }))
    cloud.eventClaim.mockResolvedValue({ reward: R({ stone: 400, dust: 50 }), day: DAY, eventId: 'e_sun_board' })
    await autoDailyTick()
    expect(cloud.eventClaim).toHaveBeenCalledTimes(1)
  })

  it('擂台屡战不下时试到当日的次数上限便收手,不无限刷', async () => {
    signIn(true)
    cloud.eventToday.mockResolvedValue(eventToday())
    cloud.eventArena.mockResolvedValue({
      day: DAY,
      eventId: 'e_tue_arena',
      runs: [],
      streak: 0,
      target: 3,
      mine: { progress: 0, claimed: false }
    })
    cloud.leisureToday.mockResolvedValue(leisureToday())

    for (let i = 0; i < 12; i += 1) await autoDailyTick()

    expect(cloud.eventArena).toHaveBeenCalledTimes(8)
    expect(cloud.eventClaim).not.toHaveBeenCalled()
  })
})

describe('闲趣三则', () => {
  it('观星代抽、垂钓竿竿钓满再收篓,谜题一概不代答', async () => {
    signIn(true)
    cloud.eventToday.mockResolvedValue(eventToday({ mine: { progress: 3, claimed: true } }))
    cloud.leisureToday.mockResolvedValue(leisureToday({ star: { drawn: false, fortune: null }, fish: { casts: 0, max: 3, basket: R(), caught: [], claimed: false } }))
    cloud.leisureStar.mockResolvedValue({
      fortune: { index: 1, rank: 3, grade: '大吉', poem: '', read: '', reward: R({ stone: 60 }) },
      reward: R({ stone: 60 }),
      already: false
    })
    let casts = 0
    cloud.leisureCast.mockImplementation(async () => {
      casts += 1
      return {
        catch: { id: 'fish', label: '一尾青鱼', reward: R({ herb: 1 }) },
        basket: R({ herb: casts }),
        caught: ['一尾青鱼'],
        casts,
        max: 3
      }
    })
    cloud.leisureClaimBasket.mockResolvedValue({ reward: R({ herb: 3 }) })

    await autoDailyTick()

    expect(cloud.leisureStar).toHaveBeenCalledTimes(1)
    expect(cloud.leisureCast).toHaveBeenCalledTimes(3)
    expect(cloud.leisureClaimBasket).toHaveBeenCalledTimes(1)
    expect(cloud.leisureAnswer).not.toHaveBeenCalled()
    expect(useResourcesStore().herb).toBe(3)
  })

  it('空篓不收:钓满也一无所获时不必把这天的额度用掉', async () => {
    signIn(true)
    cloud.eventToday.mockResolvedValue(eventToday({ mine: { progress: 3, claimed: true } }))
    cloud.leisureToday.mockResolvedValue(leisureToday({ fish: { casts: 0, max: 2, basket: R(), caught: [], claimed: false } }))
    let casts = 0
    cloud.leisureCast.mockImplementation(async () => {
      casts += 1
      return { catch: { id: 'none', label: '空钩', reward: R({}) }, basket: R({}), caught: [], casts, max: 2 }
    })

    await autoDailyTick()

    expect(cloud.leisureCast).toHaveBeenCalledTimes(2)
    expect(cloud.leisureClaimBasket).not.toHaveBeenCalled()
  })

  it('一日办妥之后不再空跑接口', async () => {
    signIn(true)
    cloud.eventToday.mockResolvedValue(eventToday({ mine: { progress: 3, claimed: true } }))
    cloud.leisureToday.mockResolvedValue(leisureToday())

    await autoDailyTick()
    await autoDailyTick()

    // 第二趟只查一次「今日是哪一会」便收手:闲趣名册不再重复拉
    expect(cloud.eventToday).toHaveBeenCalledTimes(2)
    expect(cloud.leisureToday).toHaveBeenCalledTimes(1)
  })
})
