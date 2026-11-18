/**
 * 装备托管(core/autoOps 的 autoEquipTick)的取舍与边界:
 *   一 非 VIP 概不动手(开关在背包页,非 VIP 根本看不见);
 *   二 **触发条件是「行囊满」** —— 没满时哪怕开着开关也一轮无事;
 *   三 触发后固定次序:先换最强(equipAllBest 同一把尺),再化尘弱装(belowWornTargets 的守卫);
 *   四 练过 / 词条近满 / 成套 / 上锁 / 空槽无基准的件,化尘一步永不碰。
 * 背包不进云端:这是纯客户端代办,离线无从代打,spec 只验在线一轮。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/services/cloud', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/cloud')>()),
  cloudApi: {}
}))

import { autoEquipTick, stopAutoOps } from './autoOps'
import { useAuthStore } from '@/stores/auth'
import { useGameStore } from '@/stores/game'
import { useInventoryStore } from '@/stores/inventory'
import { useResourcesStore } from '@/stores/resources'
import { useSettingsStore } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'
import { bagCapacity } from '@/data/realms'
import type { EquipmentInstance } from '@/types'

/** 登录且置成 VIP/非 VIP:auth 的 loggedIn/isVip 是 computed,只能从 token/userId/vipUntil 播种 */
function signIn(vip: boolean): void {
  const auth = useAuthStore()
  auth.token = 'tk'
  auth.userId = 7
  auth.vipUntil = vip ? Date.now() + 86_400_000 : 0
  useGameStore().started = true
}

let seq = 0
/** 桃木簪(h_muzan,无套):头槽的件;铁脊冠(h_tieji)同槽更强 */
function head(tier: number, level = 0, extra: Partial<EquipmentInstance> = {}): EquipmentInstance {
  seq += 1
  return { uid: `eq-${seq}`, templateId: 'h_muzan', quality: 'fine', tier, level, affixes: [], ...extra }
}
/** 寒锋(w_hanfeng,无套)与玄铁重剑(w_xuantie,铁壁套) */
function weapon(templateId: 'w_hanfeng' | 'w_xuantie', tier: number, extra: Partial<EquipmentInstance> = {}): EquipmentInstance {
  seq += 1
  return { uid: `eq-${seq}`, templateId, quality: 'fine', tier, level: 0, affixes: [], ...extra }
}
/** 快靴(bo_kuaixue):靴槽空穿时的垫格件 */
function boots(): EquipmentInstance {
  seq += 1
  return { uid: `eq-${seq}`, templateId: 'bo_kuaixue', quality: 'fine', tier: 1, level: 0, affixes: [] }
}

/**
 * 垫到行囊满:人间界 120 格(bagCapacity(0)),bag 只数未装备的件。
 * 垫格用空槽的靴子 —— 它们是「空槽无基准」的豁免件,不会自己跳进化尘名单,
 * 用例里谁被化尘就真的只是被点名的那些。
 */
function fillBag(inv: ReturnType<typeof useInventoryStore>): void {
  const cap = bagCapacity(0)
  while (inv.bagItems.length < cap) inv.items = [...inv.items, boots()]
}

beforeEach(() => {
  setActivePinia(createPinia())
  // 模块级的计时/冷却随循环停启归零
  stopAutoOps()
  signIn(true)
})

describe('装备托管的边界', () => {
  it('非 VIP 概不动手:行囊满了也不换不化,开关原样保留', () => {
    signIn(false)
    const inv = useInventoryStore()
    const worn = head(6)
    const weak = head(1)
    inv.items = [worn, weak]
    inv.equip(worn.uid, 'head')
    fillBag(inv)
    const s = useSettingsStore()
    s.autoEquipBest = true
    s.autoSalvageWorse = true
    autoEquipTick()
    expect(inv.findItem(weak.uid), '弱件还在').toBeDefined()
    expect(useUiStore().toasts).toHaveLength(0)
  })

  it('行囊没满:开关全开也一轮无事(平时不搅局)', () => {
    const inv = useInventoryStore()
    const worn = head(3)
    const better = head(6)
    inv.items = [worn, better]
    inv.equip(worn.uid, 'head')
    const s = useSettingsStore()
    s.autoEquipBest = true
    s.autoSalvageWorse = true
    autoEquipTick()
    expect(inv.equipped['head'], '没满就不换装').toBe(worn.uid)
    expect(inv.items).toHaveLength(2)
    expect(useUiStore().toasts).toHaveLength(0)
  })

  it('行囊满才触发:先换最强,换下的旧件当轮化尘,腾出格子', () => {
    const inv = useInventoryStore()
    const worn = head(3)
    const better = head(6)
    inv.items = [worn, better]
    inv.equip(worn.uid, 'head')
    fillBag(inv)
    expect(inv.bagFull, '垫格后须满').toBe(true)
    const s = useSettingsStore()
    s.autoEquipBest = true
    s.autoSalvageWorse = true
    autoEquipTick()
    expect(inv.equipped['head'], '换上更强的铁脊冠').toBe(better.uid)
    expect(inv.findItem(worn.uid), '换下的旧件当轮化尘').toBeUndefined()
    expect(useResourcesStore().dust, '化尘有入账').toBeGreaterThan(0)
    // 垫格的靴子落在空靴槽上:「先换最强」会顺手穿上最好的一只(空槽有候选也该穿),
    // 故行囊净减两格:旧头化尘一格 + 靴子上身一格
    expect(inv.equipped['boots'], '空槽有候选,换装一步也该穿上').toBeTruthy()
    expect(inv.bagItems.length).toBe(bagCapacity(0) - 2)
    const texts = useUiStore().toasts.map(t => t.text)
    expect(texts.some(t => t.startsWith('托管:已换上最强'))).toBe(true)
    expect(texts.some(t => t.startsWith('托管:弱装化尘'))).toBe(true)
  })

  it('只开化尘:行囊满时低于穿戴的行囊件化尘,已是穿戴者不被误伤', () => {
    const inv = useInventoryStore()
    const worn = head(6)
    const weak = head(1)
    inv.items = [worn, weak]
    inv.equip(worn.uid, 'head')
    fillBag(inv)
    useSettingsStore().autoSalvageWorse = true
    autoEquipTick()
    expect(inv.equipped['head']).toBe(worn.uid)
    expect(inv.findItem(weak.uid)).toBeUndefined()
    expect(inv.bagItems.length).toBe(bagCapacity(0) - 1)
  })

  it('守卫:上锁 / 投入过 / 词条近满 / 成套 / 空槽无基准的件一律不化尘', () => {
    const inv = useInventoryStore()
    const wornHead = head(9)
    const wornWeapon = weapon('w_hanfeng', 6)
    const guarded = [
      head(1, 0, { locked: true }), // 上锁
      head(1, 3), // 强化过 = 投入过
      head(1, 0, { affixes: [{ id: 'hp1', roll: 0.9 }] }), // 词条近满(线 0.85)
      weapon('w_xuantie', 4) // 铁壁套件,且弱于在身寒锋:凑套素材豁免
    ]
    inv.items = [wornHead, wornWeapon, ...guarded]
    inv.equip(wornHead.uid, 'head')
    inv.equip(wornWeapon.uid, 'weapon')
    fillBag(inv)
    expect(inv.bagFull).toBe(true)
    useSettingsStore().autoSalvageWorse = true
    autoEquipTick()
    for (const g of guarded) {
      expect(inv.findItem(g.uid), `${g.uid} 该被守卫豁免`).toBeDefined()
    }
    expect(useResourcesStore().dust).toBe(0)
    expect(useUiStore().toasts).toHaveLength(0)
  })

  it('只开换装:行囊满时换装不动行囊(化尘未开,旧件留包)', () => {
    const inv = useInventoryStore()
    const worn = head(3)
    const better = head(6)
    inv.items = [worn, better]
    inv.equip(worn.uid, 'head')
    fillBag(inv)
    useSettingsStore().autoEquipBest = true
    autoEquipTick()
    expect(inv.equipped['head']).toBe(better.uid)
    expect(inv.findItem(worn.uid), '化尘未开,旧件回行囊留着').toBeDefined()
    // 空靴槽的垫格靴被「换最强」顺手穿上一只,行囊净减一格
    expect(inv.bagItems.length).toBe(bagCapacity(0) - 1)
  })
})
