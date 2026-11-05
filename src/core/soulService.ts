/** 器魂服务:凝炼(销毁原器 + 耗道源)与装配的编排 */
import { refineSoul, previewSoul, canRefine } from './soulForge'
import { soulName, SOUL_SLOTS } from '@/data/souls'
import { equipmentTemplate } from '@/data/equipment'
import { track } from './progress'
import { useInventoryStore } from '@/stores/inventory'
import { useEndgameStore } from '@/stores/endgame'
import { useUiStore } from '@/stores/ui'
import { daoSourceShortfall } from './daoSource'
import { mintSoul } from './lootClaim'

/** 凝炼一枚器魂需耗的道源 */
export const SOUL_REFINE_COST = 20

/**
 * 凝炼:销毁装备,得一枚器魂;已装备、已锁定的不可凝。
 *
 * 1.58.1 起器魂也要服务端签发(记台账,否则上传时被验源移除):先签发再生效 ——
 * 签发失败就把道源退回、原器留着,不让玩家白烧一件。
 */
/** 凝炼在途:refineEquipment 里 await mintSoul(登录态是一次签发网络往返)期间,
 *  原器还没被移除、守卫全都拦不住第二次调用 —— 不加闸,连点一件原器能凝出两枚器魂 */
const refiningUids = new Set<string>()

export async function refineEquipment(uid: string): Promise<boolean> {
  const inventory = useInventoryStore()
  const endgame = useEndgameStore()
  const ui = useUiStore()

  if (refiningUids.has(uid)) return false
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
  refiningUids.add(uid)
  try {
    if (!(await mintSoul(soul))) {
      endgame.addDaoSource(SOUL_REFINE_COST)
      ui.toast('凝炼失败', 'warn')
      return false
    }
  } finally {
    refiningUids.delete(uid)
  }
  // 签发的网络往返期间原器可能被穿上/上锁/移走:以此刻状态为准,不满足就退款回收
  const now = inventory.findItem(uid)
  if (!now || now.locked || Object.values(inventory.equipped).includes(uid) || !canRefine(now)) {
    endgame.addDaoSource(SOUL_REFINE_COST)
    ui.toast('此器状态已变,凝炼中止', 'warn')
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
