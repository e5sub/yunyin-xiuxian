import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mulberry32, RandomService } from '@/utils/random'
import { generateEquipment } from './equipGen'
import { captureLoadout, applyLoadout, renameLoadout } from './loadoutService'
import { EQUIP_SLOT_NAMES, equipmentTemplate } from '@/data/equipment'
import { useInventoryStore } from '@/stores/inventory'
import { useCultivationStore } from '@/stores/cultivation'
import { useLoadoutsStore } from '@/stores/loadouts'
import { useUiStore } from '@/stores/ui'

describe('构筑快照(保存/一键切换)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  function seed(): { weaponUid: string } {
    const inventory = useInventoryStore()
    const cultivation = useCultivationStore()
    const rng = new RandomService(mulberry32(7))
    const weapon = generateEquipment(3, rng, { slot: 'weapon' })
    inventory.addEquipment(weapon)
    inventory.equip(weapon.uid, 'weapon')
    cultivation.learn('m_taixuan')
    cultivation.equipMain('m_taixuan')
    cultivation.learn('s_tuna')
    cultivation.toggleSub('s_tuna', 2)
    inventory.addArtifact('af_lihuo')
    return { weaponUid: weapon.uid }
  }

  it('捕获→改动→一键还原', () => {
    const inventory = useInventoryStore()
    const cultivation = useCultivationStore()
    const { weaponUid } = seed()

    const loadout = captureLoadout('试剑')
    expect(loadout).not.toBeNull()
    expect(loadout!.equipment.weapon).toBe(weaponUid)

    inventory.unequip('weapon')
    cultivation.subGongfa = []
    inventory.equippedArtifacts = []

    expect(applyLoadout(loadout!.id)).toBe(true)
    expect(inventory.equipped.weapon).toBe(weaponUid)
    expect(cultivation.subGongfa).toContain('s_tuna')
    expect(inventory.equippedArtifacts).toContain('af_lihuo')
  })

  it('切换还原「存时空着的位」:捕获时空着的槽,如今被占也要卸掉(不还原成杂交套)', () => {
    const inventory = useInventoryStore()
    const { weaponUid } = seed() // 只装了 weapon,head 空着
    const loadout = captureLoadout('空槽')!
    expect(loadout.equipment.head, '捕获时 head 空着 → 快照不记该位').toBeUndefined()

    const rng = new RandomService(mulberry32(11))
    const helm = generateEquipment(3, rng, { slot: 'head' })
    inventory.addEquipment(helm)
    inventory.equip(helm.uid, 'head')
    expect(inventory.equipped.head).toBe(helm.uid)

    applyLoadout(loadout.id)
    expect(inventory.equipped.head, '空槽位应还原为空').toBeUndefined()
    expect(inventory.equipped.weapon, '存着的 weapon 应穿回').toBe(weaponUid)
  })

  it('部件缺失时跳过而不崩溃,且缺件的名有姓地报出来', () => {
    const inventory = useInventoryStore()
    const ui = useUiStore()
    const { weaponUid } = seed()
    const loadout = captureLoadout('残卷')!
    inventory.removeEquipment(weaponUid)
    expect(applyLoadout(loadout.id)).toBe(true)
    expect(inventory.equipped.weapon).toBeUndefined()
    const last = ui.toasts[ui.toasts.length - 1]!.text
    expect(last).toContain(EQUIP_SLOT_NAMES.weapon)
  })

  it('槽位错配的装备不会被穿到错误位置', () => {
    const inventory = useInventoryStore()
    seed()
    const loadout = captureLoadout('验位')!
    const rng = new RandomService(mulberry32(9))
    const body = generateEquipment(3, rng, { slot: 'body' })
    inventory.addEquipment(body)
    loadout.equipment.weapon = body.uid
    applyLoadout(loadout.id)
    const equippedWeapon = inventory.equipped.weapon
    if (equippedWeapon) {
      expect(equipmentTemplate(inventory.findItem(equippedWeapon)!.templateId)!.slot).toBe('weapon')
    } else {
      expect(equippedWeapon).toBeUndefined()
    }
  })

  it('快照里的主修/辅修门类写错时,切换构筑不把主修塞进辅修席', () => {
    const cultivation = useCultivationStore()
    seed()
    const loadout = captureLoadout('错门类')!
    loadout.mainGongfa = 's_tuna'
    loadout.subGongfa = ['m_taixuan', 's_tuna']
    applyLoadout(loadout.id)
    expect(cultivation.mainGongfa, '辅修不能借快照占主修席').toBe('m_taixuan')
    expect(cultivation.subGongfa, '主修不能借快照占辅修席').toEqual(['s_tuna'])
  })

  it('容量上限生效', () => {
    seed()
    const loadouts = useLoadoutsStore()
    for (let i = 0; i < 6; i += 1) {
      captureLoadout(`第${i}套`)
    }
    expect(loadouts.list.length).toBe(6)
    expect(captureLoadout('超载')).toBeNull()
  })

  it('改名:收敛空白与 8 字上限,套内装束原样不动,提示说「已改名」而非「已保存」', () => {
    seed()
    const loadouts = useLoadoutsStore()
    const ui = useUiStore()
    const lo = captureLoadout('背水一号')!
    const weaponUid = lo.equipment.weapon
    expect(renameLoadout(lo.id, '   ')).toBe(true)
    expect(loadouts.list.find(l => l.id === lo.id)!.name).toBe('无名构筑')
    // captureLoadout 那一声「已保存」在更早,断言只看最新一条
    const lastToast = ui.toasts[ui.toasts.length - 1]!.text
    expect(lastToast).toContain('已改名')
    expect(lastToast).not.toContain('已保存')
    expect(renameLoadout(lo.id, '超长名字超过八个字会截断')).toBe(true)
    expect(loadouts.list.find(l => l.id === lo.id)!.name).toBe('超长名字超过八个')
    const renamed = loadouts.list.find(l => l.id === lo.id)!
    expect(renamed.equipment.weapon).toBe(weaponUid)
    expect(renamed.mainGongfa).toBe('m_taixuan')
    expect(renameLoadout('nope', '新名')).toBe(false)
    expect(loadouts.list.length).toBe(1)
  })

  /** 藏经阁 0 级只有 1 个辅修槽 */
  it('辅修槽不够时,被砍的那件也要带名报出来,并标出槽位不足', () => {
    const cultivation = useCultivationStore()
    const ui = useUiStore()
    seed()
    cultivation.learn('s_lianti')
    const loadout = captureLoadout('双辅修')!
    loadout.subGongfa = ['s_tuna', 's_lianti']
    applyLoadout(loadout.id)

    expect(cultivation.subGongfa).toEqual(['s_tuna'])
    const last = ui.toasts[ui.toasts.length - 1]!.text
    expect(last, '被砍的那件要带名').toContain('百炼锻体术')
    expect(last, '说清这不是靠历练能补的').toContain('槽位不足')
  })

  it('法宝位不够时,被砍的那件也点名;没有槽位问题时不说「槽位不足」', () => {
    const inventory = useInventoryStore()
    const ui = useUiStore()
    seed()
    // 炼气期只有 1 个法宝位
    inventory.addArtifact('af_lihuo')
    inventory.addArtifact('af_muyu')
    const loadout = captureLoadout('双法宝')!
    loadout.artifactIds = ['af_lihuo', 'af_muyu']
    applyLoadout(loadout.id)

    expect(inventory.equippedArtifacts).toHaveLength(1)
    const last = ui.toasts[ui.toasts.length - 1]!.text
    expect(last, '被砍的法宝要带名').toContain('墨玉葫芦')
    expect(last, '说清这不是靠历练能补的').toContain('槽位不足')
  })

  it('部件齐备时不说「槽位不足」(正对照:不是每条都挂这句)', () => {
    const inventory = useInventoryStore()
    const ui = useUiStore()
    const { weaponUid } = seed()
    const loadout = captureLoadout('齐套')!
    applyLoadout(loadout.id)
    expect(inventory.equipped.weapon).toBe(weaponUid)
    const last = ui.toasts[ui.toasts.length - 1]!.text
    expect(last).not.toContain('槽位不足')
  })
})

describe('构筑快照 · 副席:辅修与秘术各算各的账', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('一辅修 + 一秘术的快照,在只一席辅修时也能整套还原', () => {
    const cultivation = useCultivationStore()
    const ui = useUiStore()
    cultivation.learn('s_tuna')
    cultivation.learn('x_tianyan')
    cultivation.toggleSub('s_tuna', 1)
    cultivation.toggleSub('x_tianyan', 1)
    const loadout = captureLoadout('双席')!

    cultivation.subGongfa = []
    expect(applyLoadout(loadout.id)).toBe(true)
    expect(cultivation.subGongfa).toEqual(['s_tuna', 'x_tianyan'])
    expect(ui.toasts[ui.toasts.length - 1]!.text, '两本都在席,不该报缺件').toBe('已换上「双席」')
  })

  it('第二本秘术在快照里仍是超席,并带名报出', () => {
    const cultivation = useCultivationStore()
    const ui = useUiStore()
    cultivation.learn('s_tuna')
    cultivation.learn('x_tianyan')
    cultivation.learn('x_sanqing')
    const loadout = captureLoadout('双秘术')!
    loadout.subGongfa = ['s_tuna', 'x_tianyan', 'x_sanqing']
    applyLoadout(loadout.id)

    expect(cultivation.subGongfa).toEqual(['s_tuna', 'x_tianyan'])
    const last = ui.toasts[ui.toasts.length - 1]!.text
    expect(last).toContain('一气化三清')
    expect(last).toContain('槽位不足')
  })
})
