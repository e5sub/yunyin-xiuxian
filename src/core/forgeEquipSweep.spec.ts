/**
 * 一键强化(身上已装备的逐件 +1):按部位顺序、每件只掷一次、料尽即止、满级跳过。
 * 掷点打桩与 forgeUpgrade 同法:0 → 必成,1 → 必失手。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { EquipSlot, EquipmentInstance } from '@/types'
import { useInventoryStore } from '@/stores/inventory'
import { usePlayerStore } from '@/stores/player'
import { useResourcesStore } from '@/stores/resources'
import { useQuestsStore } from '@/stores/quests'
import { useUiStore } from '@/stores/ui'
import { ACHIEVEMENTS } from '@/data/achievements'
import { MAIN_QUESTS } from '@/data/quests'
import { EQUIPMENT_TEMPLATES, EQUIP_SLOTS } from '@/data/equipment'
import { UPGRADE_SAFE_STEP } from '@/data/constants'
import { gn, gnZero } from '@/utils/gnum'
import { upgradeCost } from './formulas'
import { equipLevelCap, equipSweepPlan, upgradeEquippedOnce } from './forge'

/** 该部位一件无门槛模板:用于摆真装备(equip 要查模板与境界门槛) */
function templateOf(slot: EquipSlot): string {
  return EQUIPMENT_TEMPLATES.find(t => t.slot === slot && !t.minRealm)!.id
}

/** 摆一件并穿到指定部位 */
function wear(slot: EquipSlot, level = 0, quality: EquipmentInstance['quality'] = 'mortal'): EquipmentInstance {
  const item: EquipmentInstance = { uid: `u-${slot}`, templateId: templateOf(slot), quality, tier: 3, level, affixes: [] }
  const inv = useInventoryStore()
  inv.items = [...inv.items, item]
  inv.equip(item.uid, slot)
  return item
}

function wearSlots(slots: readonly EquipSlot[], level = 0): void {
  for (const slot of slots) wear(slot, level)
}

/** 0 级凡品 3 阶的三样成本(折扣为 0) */
function costAt(lv: number): { dust: number; stone: ReturnType<typeof gnZero>; exp: ReturnType<typeof gnZero> } {
  return upgradeCost(lv, 3, 0, 0)
}

function rich(): void {
  useResourcesStore().dust = 1_000_000_000
  useResourcesStore().spiritStone = gn(1e30)
  usePlayerStore().exp = gn(1e30)
}

/** 掷点打桩:0 → 必成;1 → 必失手 */
function roll(always: 'success' | 'fail'): void {
  vi.spyOn(Math, 'random').mockReturnValue(always === 'success' ? 0 : 1)
}

afterEach(() => vi.restoreAllMocks())

beforeEach(() => {
  setActivePinia(createPinia())
  // 首次强化有成就赏:预先结清,免得赏的尘石修为混进余额断言
  useQuestsStore().$patch({ achieved: ACHIEVEMENTS.map(a => a.id), mainIdx: MAIN_QUESTS.length - 1 })
})

describe('一键强化 · 计划(只算不扣)', () => {
  it('空身:无槽位、无停手,一件不动', () => {
    const plan = equipSweepPlan()
    expect(plan.queue).toEqual([])
    expect(plan.capped).toBe(0)
    expect(plan.stoppedAt).toBeNull()
    expect(plan.short).toBeNull()
    const r = upgradeEquippedOnce()
    expect(r).toEqual({ tried: 0, ups: 0, fails: 0, capped: 0 })
    expect(useUiStore().toasts.at(-1)?.text).toContain('尚无装备可强')
  })

  it('按部位顺序排队:顺序即优先级', () => {
    // 逆序穿,计划仍按 EQUIP_SLOTS 的次序
    wearSlots(['body', 'head', 'weapon'])
    rich()
    expect(equipSweepPlan().queue).toEqual(['weapon', 'head', 'body'])
  })

  it('料只够两件:排在第三的那件停在原处,后面的便宜件不插队', () => {
    wearSlots(['weapon', 'head', 'body'])
    const r = useResourcesStore()
    // 尘只够两次 0 级强化
    r.dust = costAt(0).dust * 2
    r.spiritStone = gn(1e30)
    usePlayerStore().exp = gn(1e30)
    const plan = equipSweepPlan()
    expect(plan.queue).toEqual(['weapon', 'head'])
    expect(plan.stoppedAt).toBe('body')
    expect(plan.short).toBe('dust')
    expect(plan.gap.dust).toBe(costAt(0).dust)
  })

  it('修为不够同样停在那一件,short 报修为', () => {
    wearSlots(['weapon', 'head'])
    const r = useResourcesStore()
    r.dust = 1_000_000_000
    r.spiritStone = gn(1e30)
    const need = costAt(0).exp
    usePlayerStore().exp = need // 只够一件
    const plan = equipSweepPlan()
    expect(plan.queue).toEqual(['weapon'])
    expect(plan.stoppedAt).toBe('head')
    expect(plan.short).toBe('exp')
  })

  it('满级件跳过不掷、计入 capped,不占本轮额度', () => {
    wear('weapon', equipLevelCap())
    wear('head', 0)
    rich()
    const plan = equipSweepPlan()
    expect(plan.queue).toEqual(['head'])
    expect(plan.capped).toBe(1)
    expect(plan.stoppedAt).toBeNull()
  })

  it('计划不动手:余额与等级分文未变', () => {
    wearSlots(['weapon', 'head'])
    rich()
    const r = useResourcesStore()
    const d0 = r.dust
    equipSweepPlan()
    expect(r.dust).toBe(d0)
    expect(useInventoryStore().findItem('u-weapon')!.level).toBe(0)
  })
})

describe('一键强化 · 下手(每件各掷一次)', () => {
  it('九件全成:每件只 +1,一次点击齐进一级', () => {
    wearSlots(EQUIP_SLOTS)
    rich()
    roll('success')
    const out = upgradeEquippedOnce()
    expect(out).toEqual({ tried: EQUIP_SLOTS.length, ups: EQUIP_SLOTS.length, fails: 0, capped: 0 })
    for (const slot of EQUIP_SLOTS) {
      expect(useInventoryStore().findItem(`u-${slot}`)!.level).toBe(1)
    }
    expect(useUiStore().toasts.at(-1)?.text).toContain('各掷一次')
  })

  it('每件只掷一次:0 级必成也只到 +1,不会顶到上限', () => {
    wearSlots(['weapon'])
    rich()
    roll('success')
    upgradeEquippedOnce()
    expect(useInventoryStore().findItem('u-weapon')!.level).toBe(1)
  })

  it('失手踩在保级点:不掉级,计一次失手', () => {
    wear('weapon', UPGRADE_SAFE_STEP)
    rich()
    roll('fail')
    const out = upgradeEquippedOnce()
    expect(out).toEqual({ tried: 1, ups: 0, fails: 1, capped: 0 })
    expect(useInventoryStore().findItem('u-weapon')!.level).toBe(UPGRADE_SAFE_STEP)
    expect(useUiStore().toasts.at(-1)?.text).toContain('失手 1')
  })

  it('料尽即止:第三件分文不动,已强的两件照常留下', () => {
    wearSlots(['weapon', 'head', 'body'])
    const r = useResourcesStore()
    r.dust = costAt(0).dust * 2
    r.spiritStone = gn(1e30)
    usePlayerStore().exp = gn(1e30)
    roll('success')
    const out = upgradeEquippedOnce()
    expect(out.tried).toBe(2)
    expect(out.ups).toBe(2)
    expect(useInventoryStore().findItem('u-weapon')!.level).toBe(1)
    expect(useInventoryStore().findItem('u-head')!.level).toBe(1)
    expect(useInventoryStore().findItem('u-body')!.level).toBe(0)
    expect(r.dust).toBe(0)
    // 停手的那一件报在总账里
    expect(useUiStore().toasts.at(-1)?.text).toContain('衣袍')
  })

  it('一件都付不起:不掷、不扣、只报一件未强', () => {
    wearSlots(['weapon'])
    const r = useResourcesStore()
    r.dust = 0
    r.spiritStone = gnZero()
    usePlayerStore().exp = gnZero()
    const out = upgradeEquippedOnce()
    expect(out).toEqual({ tried: 0, ups: 0, fails: 0, capped: 0 })
    expect(useInventoryStore().findItem('u-weapon')!.level).toBe(0)
    expect(useUiStore().toasts.at(-1)?.text).toContain('一件未强')
  })

  it('满级件不掷:全部满级时只报已至上限', () => {
    wearSlots(EQUIP_SLOTS, equipLevelCap())
    rich()
    const out = upgradeEquippedOnce()
    expect(out).toEqual({ tried: 0, ups: 0, fails: 0, capped: EQUIP_SLOTS.length })
    expect(useUiStore().toasts.at(-1)?.text).toContain('上限')
  })
})
