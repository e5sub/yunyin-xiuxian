/**
 * VIP 离线挂机的三条口径(与 gameplay 对齐的那三处):
 *   一 归来领的是「已经发生」的事:VIP 在离线途中到期,台账照领不误(原先要 isVip 才给);
 *   二 出剑无资粮,所得全在击杀赏:领的时候顺手把赏领掉,不再报一笔「灵石 +0」的假账;
 *   三 到期即全关:七枚托管开关自动关闭、vipUntil 落 0;离线补推仍按「离开时是否 VIP」判 —— 已付时间覆盖的那段照算。
 * 云接口整体替身:托管只认「服务端怎么回」,不认界面怎么显示。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { AUTO_REGION_ID } from '@/data/constants'

const cloud = vi.hoisted(() => ({
  vipAutoOps: vi.fn(),
  collectVipAutoOps: vi.fn(),
  bossClaim: vi.fn(),
  eventToday: vi.fn()
}))

vi.mock('@/services/cloud', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/cloud')>()),
  cloudApi: cloud
}))

import { collectOfflineBossLedger, prepOfflineAutoOps, autoDailyTick, stopAutoOps } from './autoOps'
import { useAuthStore } from '@/stores/auth'
import { useGameStore } from '@/stores/game'
import { useSettingsStore } from '@/stores/settings'
import { useAdventureStore } from '@/stores/adventure'
import { useCultivationStore } from '@/stores/cultivation'
import { useResourcesStore } from '@/stores/resources'
import { useUiStore } from '@/stores/ui'
import { toNum } from '@/utils/gnum'

const HOUR = 3_600_000

/** 登录并按需播种 VIP 到期时间:vipUntil 是 isVip 的唯一来源 */
function signIn(vipUntil: number): void {
  const auth = useAuthStore()
  auth.token = 'tk'
  auth.userId = 7
  auth.vipUntil = vipUntil
}

/** 离线 n 小时:lastActiveAt 落后,且已开局 */
function offlineFor(ms: number): void {
  const game = useGameStore()
  game.started = true
  game.lastActiveAt = Date.now() - ms
}

function pending(strikes: number, skip: { reason: string; at: number } | null = null) {
  return { collected: { stoneM: 0, stoneE: 0, herb: 0, strikes, tier: 2 }, skip }
}

beforeEach(() => {
  setActivePinia(createPinia())
  stopAutoOps()
  for (const fn of Object.values(cloud)) fn.mockReset()
  cloud.bossClaim.mockResolvedValue({ pending: { stone: 0, herb: 0, equip: false } })
  cloud.eventToday.mockResolvedValue({ enabled: true, day: '2026-11-16' })
})

describe('离线讨伐所得领取', () => {
  it('VIP 已到期也照领:领的是已经发生的讨伐,不是此刻的特权', async () => {
    signIn(Date.now() - HOUR) // 一小时前就到期了
    cloud.collectVipAutoOps.mockResolvedValue(pending(2))

    await collectOfflineBossLedger()

    expect(cloud.collectVipAutoOps).toHaveBeenCalledTimes(1)
    expect(useUiStore().toasts.at(-1)?.text).toContain('出剑 2 次')
  })

  it('出剑无资粮:所得从击杀赏来,领取时顺手带上,不再报「灵石 +0」', async () => {
    signIn(Date.now() + 86_400_000)
    cloud.collectVipAutoOps.mockResolvedValue(pending(1))
    cloud.bossClaim.mockResolvedValue({ pending: { stone: 120, herb: 2, equip: false } })

    await collectOfflineBossLedger()

    expect(cloud.bossClaim, '击杀赏该顺手领掉').toHaveBeenCalledTimes(1)
    const text = useUiStore().toasts.map(t => t.text).join(' | ')
    expect(text).toContain('出剑 1 次')
    expect(text, '假账不许再报').not.toContain('灵石 +0')
    expect(toNum(useResourcesStore().spiritStone), '击杀赏灵石该真入账').toBeGreaterThan(0)
  })

  it('一剑没打也说清缘由:蓄势 / 次数尽 / 妖王未生', async () => {
    signIn(Date.now() + 86_400_000)
    cloud.collectVipAutoOps.mockResolvedValue(pending(0, { reason: 'hold', at: Date.now() }))

    await collectOfflineBossLedger()

    const text = useUiStore().toasts.at(-1)?.text ?? ''
    expect(text).toContain('未出剑')
    expect(text).toContain('蓄势')
  })
})

describe('离线补推的 VIP 判据', () => {
  it('离开时是 VIP、归来已到期:整段仍按托管结算', async () => {
    const now = Date.now()
    offlineFor(8 * HOUR)
    signIn(now - 2 * HOUR) // 离开时(8 小时前)还没到期,归来已过期
    useSettingsStore().autoRetreat = true
    useSettingsStore().autoAdventure = false
    cloud.vipAutoOps.mockResolvedValue({
      settings: { autoBoss: false, autoRetreat: true, autoAdventure: false, regionId: AUTO_REGION_ID, mode: 'normal', bossDifficulty: 'normal' }
    })

    await prepOfflineAutoOps()

    expect(
      useCultivationStore().buffs.some(b => b.defId === 'retreat'),
      '离开时还没到期的这一段,闭关 buff 该补活'
    ).toBe(true)
  })

  it('离开时就已经过期:不补推,一步不动', async () => {
    offlineFor(8 * HOUR)
    signIn(Date.now() - 10 * HOUR) // 十小时前就到期,离开时(八小时前)早已过期
    useSettingsStore().autoRetreat = true
    cloud.vipAutoOps.mockResolvedValue({
      settings: { autoBoss: false, autoRetreat: true, autoAdventure: false, regionId: AUTO_REGION_ID, mode: 'normal', bossDifficulty: 'normal' }
    })

    await prepOfflineAutoOps()

    expect(useCultivationStore().buffs.some(b => b.defId === 'retreat')).toBe(false)
    expect(useAdventureStore().session).toBeNull()
  })
})

describe('到期全关(1.74.4)', () => {
  it('到期那一刻托管不动手,七枚托管开关一并自动关闭、vipUntil 落 0', async () => {
    const now = Date.now()
    offlineFor(0)
    signIn(now - HOUR) // 一小时前就到期
    const settings = useSettingsStore()
    const auth = useAuthStore()
    settings.autoDailyEvent = true
    settings.autoEquipBest = true
    settings.autoSalvageWorse = true

    await autoDailyTick()

    expect(cloud.eventToday, '非 VIP 不该动手').not.toHaveBeenCalled()
    expect(settings.autoDailyEvent, '托管到期即关,不留隐性档').toBe(false)
    expect(settings.autoEquipBest).toBe(false)
    expect(settings.autoSalvageWorse).toBe(false)
    expect(auth.vipUntil, '过期时间戳落 0,触发全站隐藏').toBe(0)
  })
})
