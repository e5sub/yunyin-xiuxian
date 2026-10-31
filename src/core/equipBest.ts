/**
 * 一键换装:每槽换上最强一件,已是最强则不动(幂等)。只改装配,不分解、不炼化、不卖;换下的回行囊。
 * 「最强」= 真实战力(equippablePower),词条权重与战力面板同源(powerRating);粗排(betterEquip)只作同分裁决。
 */
import { useInventoryStore } from '@/stores/inventory'
import { qualityDef } from '@/data/qualities'
import { EQUIP_SLOTS, equipmentTemplate } from '@/data/equipment'
import { resolveEquipStats } from './equipGen'
import { POWER_STAT_WEIGHTS } from './powerRating'
import { toNum } from '@/utils/gnum'
import type { AnyStatKey, EquipmentInstance, EquipSlot } from '@/types'

/** 兼容别名;部位的唯一事实源在 data/equipment */
export { EQUIP_SLOTS }

function qualityRank(i: EquipmentInstance): number {
  return qualityDef(i.quality).rank
}

function rollSum(i: EquipmentInstance): number {
  return i.affixes.reduce((s, x) => s + x.roll, 0)
}

/** 血条平铺对攻/防当量的折算 */
const HP_FLAT_WEIGHT = 1 / 6

/**
 * 一件装备的真实战斗价值(一键「最强」的口径):攻/防/血平铺 + 词条战力。
 * 会心按「会心×(1+会心伤)」联乘,其余走战力面板权重表;成长类词条不进战力。
 */
export function equippablePower(i: EquipmentInstance): number {
  const r = resolveEquipStats(i)
  const f = r.flats
  // toNum 在 e>308 返回 Infinity,夹回 0,免得多件战力全平手
  const finite = (n: number): number => (Number.isFinite(n) ? n : 0)
  let value = finite(toNum(f.attack)) + finite(toNum(f.defense)) + finite(toNum(f.maxHp)) * HP_FLAT_WEIGHT
  const critRate = r.mods.critRate ?? 0
  const critDamage = r.mods.critDamage ?? 0
  value += critRate * (1 + critDamage)
  for (const [k, raw] of Object.entries(r.mods)) {
    if (k === 'critRate' || k === 'critDamage') continue
    value += (POWER_STAT_WEIGHTS[k as AnyStatKey] ?? 0) * (raw ?? 0)
  }
  return value
}

/** a 是否严格强于 b(阶级 → 层级 → 强化 → 词条成色);用于同战力裁决与列表排序 */
export function betterEquip(a: EquipmentInstance, b: EquipmentInstance): boolean {
  const qa = qualityRank(a)
  const qb = qualityRank(b)
  if (qa !== qb) return qa > qb
  if (a.tier !== b.tier) return a.tier > b.tier
  if (a.level !== b.level) return a.level > b.level
  return rollSum(a) > rollSum(b)
}

/** a 是否严格强于 b:真实战力为主,同分回退粗排;一键换装与穿套共用 */
function stronger(a: EquipmentInstance, b: EquipmentInstance): boolean {
  const pa = equippablePower(a)
  const pb = equippablePower(b)
  if (pa !== pb) return pa > pb
  return betterEquip(a, b)
}

/**
 * 该槽最强一件;无可穿戴时返回 null。
 * 「可穿戴」含境界门槛:太初四阶的仙品件未到境者不进候选,一键换装不会替他穿上。
 */
export function bestEquipFor(slot: EquipSlot): EquipmentInstance | null {
  const inventory = useInventoryStore()
  const pool = inventory.items.filter(
    i => equipmentTemplate(i.templateId)?.slot === slot && inventory.canEquipTemplate(i.templateId)
  )
  if (pool.length === 0) return null
  return pool.reduce((a, b) => (stronger(b, a) ? b : a))
}

/** 一键换装单槽:换上最强一件,已是则不动。返回是否真的换了 */
export function equipBestFor(slot: EquipSlot): boolean {
  const inventory = useInventoryStore()
  const best = bestEquipFor(slot)
  if (!best) return false
  if (inventory.equipped[slot] === best.uid) return false
  return inventory.equip(best.uid, slot)
}

/** 一键换装全部槽位,返回换了几件 */
export function equipAllBest(): number {
  let changed = 0
  for (const slot of EQUIP_SLOTS) {
    if (equipBestFor(slot)) changed += 1
  }
  return changed
}

/** 空一身:卸下全部已佩戴的装备(回行囊,不分解不炼化),返回卸了几件 */
export function unequipAllEquipped(): number {
  const inventory = useInventoryStore()
  let removed = 0
  for (const slot of EQUIP_SLOTS) {
    if (inventory.equipped[slot]) {
      inventory.unequip(slot)
      removed += 1
    }
  }
  return removed
}

/** 该套每槽已持有里最强的一件;穿齐与预览共用 */
function bestSetPieces(setId: string): Map<EquipSlot, EquipmentInstance> {
  const inventory = useInventoryStore()
  const bestPerSlot = new Map<EquipSlot, EquipmentInstance>()
  for (const it of inventory.items) {
    const tpl = equipmentTemplate(it.templateId)
    if (!tpl || tpl.set !== setId) continue
    const cur = bestPerSlot.get(tpl.slot)
    if (!cur || stronger(it, cur)) bestPerSlot.set(tpl.slot, it)
  }
  return bestPerSlot
}

/** 一键穿齐某共鸣套:每槽换上该套已持有里最强的一件,已穿更强则不动(不降级);返回换上几件 */
export function equipSetCombo(setId: string): number {
  const inventory = useInventoryStore()
  let changed = 0
  for (const [slot, piece] of bestSetPieces(setId)) {
    if (inventory.equipped[slot] === piece.uid) continue
    const occupant = inventory.equipped[slot] ? inventory.findItem(inventory.equipped[slot]!) : undefined
    if (occupant && stronger(occupant, piece)) continue
    if (!inventory.canEquip(piece.uid)) continue
    if (inventory.equip(piece.uid, slot)) changed += 1
  }
  return changed
}

/** 干跑:这套会换上几件,只数不动,按钮「穿齐 →(换 N)」用;须与 equipSetCombo 同一份取舍 */
export function equipSetPreview(setId: string): number {
  const inventory = useInventoryStore()
  let changed = 0
  for (const [slot, piece] of bestSetPieces(setId)) {
    if (inventory.equipped[slot] === piece.uid) continue
    const occupant = inventory.equipped[slot] ? inventory.findItem(inventory.equipped[slot]!) : undefined
    if (occupant && stronger(occupant, piece)) continue
    if (!inventory.canEquip(piece.uid)) continue
    changed += 1
  }
  return changed
}
