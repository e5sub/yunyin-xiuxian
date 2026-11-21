/**
 * 服务端自己结算出来的物件,补进签发台账。
 *
 * 权威推进(/game/advance)与动作结算(/api/action)都在服务端跑客户端的同一份结算代码,
 * 跑完可能多出装备/法宝 —— 这些件没有经过 /loot/claim,台账里没有行。
 * 不补账的话,客户端下一次 PUT /save 的验源会把它们当「无主之件」整批移除:
 * 玩家在服务端合法打到的东西反而消失了。
 *
 * 记账失败必须让调用方整体作废(不回包):宁可让客户端重来一次,
 * 也不能把无账之件放进云档 —— 那等于给改包留了一条「服务端盖过章」的路。
 */
import { pruneLoot, recordLoot } from './lootLedger.js'
import { pruneEquipStates, recordEquipStatesFromItems } from './equipLedger.js'

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 分片里实际持有的三类物件(与台账键同口径) */
export function heldKeys(data: Record<string, unknown>): { equips: string[]; artifacts: string[]; souls: string[] } {
  const inv = isPlainObject(data.inventory) ? data.inventory : {}
  const endgame = isPlainObject(data.endgame) ? data.endgame : {}
  const equips: string[] = []
  const artifacts: string[] = []
  const souls: string[] = []
  const items = Array.isArray(inv.items) ? inv.items : []
  for (const it of items) {
    if (isPlainObject(it) && typeof it.uid === 'string') equips.push(it.uid)
  }
  const arts = Array.isArray(inv.artifacts) ? inv.artifacts : []
  for (const a of arts) {
    if (typeof a === 'string') artifacts.push(a)
    else if (isPlainObject(a) && typeof a.defId === 'string') artifacts.push(a.defId)
  }
  const rawSouls = Array.isArray(endgame.souls) ? endgame.souls : []
  for (const s of rawSouls) {
    if (isPlainObject(s) && typeof s.uid === 'string') souls.push(s.uid)
  }
  return { equips, artifacts, souls }
}

/**
 * 服务端动作结算后让账本跟着云档收口:离手的件立刻清签发行与状态行。
 *
 * 不这么做时,卖掉/分解的件仍留着账;客户端若还拿着旧行囊点强化,1.79.5 的
 * 「按账补册」就会把已经离手的件复活。云档是权威,账本也必须以云档为准。
 */
export async function reconcileHeldLoot(userId: number, data: Record<string, unknown>): Promise<void> {
  const held = heldKeys(data)
  await pruneLoot(userId, {
    equip: new Set(held.equips),
    artifact: new Set(held.artifacts),
    soul: new Set(held.souls)
  })
  await pruneEquipStates(userId, new Set(held.equips))
}

/** 把 before→after 之间新出现的装备/法宝/器魂补进台账;任一步失败则抛出,由调用方整体回滚 */
export async function syncNewLoot(
  userId: number,
  data: Record<string, unknown>,
  before: { equips: string[]; artifacts: string[]; souls?: string[] },
  source: string
): Promise<{ equips: string[]; artifacts: string[]; souls: string[] }> {
  const after = heldKeys(data)
  const beforeEquip = new Set(before.equips)
  const beforeArt = new Set(before.artifacts)
  const beforeSoul = new Set(before.souls ?? [])
  const newEquips = after.equips.filter(k => !beforeEquip.has(k))
  const newArts = after.artifacts.filter(k => !beforeArt.has(k))
  const newSouls = after.souls.filter(k => !beforeSoul.has(k))
  if (newEquips.length > 0) {
    await recordLoot(userId, newEquips, source)
    const inv = isPlainObject(data.inventory) ? data.inventory : {}
    const items = (Array.isArray(inv.items) ? inv.items : []).filter(
      it => isPlainObject(it) && typeof it.uid === 'string' && newEquips.includes(it.uid)
    ) as Array<Record<string, unknown>>
    await recordEquipStatesFromItems(userId, items)
  }
  if (newArts.length > 0) await recordLoot(userId, newArts, source, 'artifact')
  if (newSouls.length > 0) await recordLoot(userId, newSouls, source, 'soul')
  return { equips: newEquips, artifacts: newArts, souls: newSouls }
}
