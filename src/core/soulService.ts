/** 器魂服务:凝炼(销毁原器 + 耗道源)与装配的编排 */
import { refineSoul, previewSoul, canRefine } from './soulForge'
import { soulName, SOUL_SLOTS } from '@/data/souls'
import { equipmentTemplate } from '@/data/equipment'
import { track } from './progress'
import { useInventoryStore } from '@/stores/inventory'
import { useEndgameStore } from '@/stores/endgame'
import { useUiStore } from '@/stores/ui'
import { daoSourceShortfall } from './daoSource'

/** 凝炼一枚器魂需耗的道源 */
export const SOUL_REFINE_COST = 20

/** 凝炼:销毁装备,得一枚器魂;已装备、已锁定的不可凝 */
export function refineEquipment(uid: string): boolean {
  const inventory = useInventoryStore()
  const endgame = useEndgameStore()
  const ui = useUiStore()

  const inst = inventory.findItem(uid)
  if (!inst) return false
  if (inst.locked) {
    ui.toast('此器已上锁', 'warn')
    return false
  }
  if (Object.values(inventory.equipped).includes(uid)) {
    ui.toast('此器已装备', 'warn')
    return false
  }
  if (!canRefine(inst)) {
    ui.toast('此器无形意', 'warn')
    return false
  }
  const short = daoSourceShortfall(SOUL_REFINE_COST, endgame.daoSource)
  if (!endgame.spendDaoSource(SOUL_REFINE_COST)) {
    ui.toast(short.reason ?? `道源不足 ${SOUL_REFINE_COST}`, 'warn')
    return false
  }

  const soul = refineSoul(inst)
  if (!soul) {
    // canRefine 已挡住,退款兜底
    endgame.addDaoSource(SOUL_REFINE_COST)
    return false
  }
  inventory.removeEquipment(uid)
  endgame.addSoul(soul)
  track('soulsRefined')
  const t = equipmentTemplate(inst.templateId)
  ui.toast(`「${t?.name}」凝作${soulName(soul)}`, 'rare')
  return true
}

/** 装配器魂;槽位满时提示 */
export function wearSoul(uid: string): boolean {
  const endgame = useEndgameStore()
  const ui = useUiStore()
  if (endgame.activeSouls.length >= SOUL_SLOTS && !endgame.activeSouls.some(s => s.uid === uid)) {
    ui.toast(`装配已满(${SOUL_SLOTS} 缕)`, 'warn')
    return false
  }
  // equipSoul 按有效装配(滤掉 ghost)判槽位;已装配/不在持有池时静默返回
  return endgame.equipSoul(uid)
}

export function removeSoul(uid: string): void {
  useEndgameStore().unequipSoul(uid)
}

/** 散去器魂(不可逆) */
export function dissolveSoul(uid: string): void {
  const endgame = useEndgameStore()
  const ui = useUiStore()
  const soul = endgame.soulList.find(s => s.uid === uid)
  if (!soul) return
  endgame.dissolveSoul(uid)
  ui.toast(`${soulName(soul)}已散去`, 'info')
}

export { previewSoul, canRefine }
