/**
 * 掉落台账:行囊里每件装备的 uid 须由 /api/loot/claim 签发并记入 loot_ledger;
 * 上传存档时验源,非签发件移除并留痕(1.58.0 掉落服务端权威化的落库侧)。
 *
 * 播种只此一次:存量档首次过验源时把行囊现有 uid 一次性入账(旧件来源无从考证,
 * 不追溯);标记落在 loot_seed 表 —— 删档重传不重播,否则「造一件 → 删档 → 重播」就是作弊环。
 */
import { all, get, run } from './db.js'

/** 行囊 uid 全集;玩家删除存档不重播种子,签发台账随签到删 */
export async function lootProvenance(userId: number): Promise<{ seeded: boolean; known: Set<string> }> {
  const seededRow = await get<{ seeded_at: number }>('SELECT seeded_at FROM loot_seed WHERE user_id = ?', [userId])
  if (seededRow === undefined) return { seeded: false, known: new Set() }
  const rows = await all<{ uid: string }>('SELECT uid FROM loot_ledger WHERE user_id = ?', [userId])
  return { seeded: true, known: new Set(rows.map(r => r.uid)) }
}

/** 签发入账:uid 批量记台账(src 记来源,便于 GM 追数量异常) */
export async function recordLoot(userId: number, uids: readonly string[], src: string): Promise<void> {
  const now = Date.now()
  for (const uid of uids) {
    if (typeof uid !== 'string' || uid === '' || uid.length > 64) continue
    // REPLACE:同 uid 重签(理论不该发生)以最后一次为准,不因主键冲突把整批掷失败
    await run('REPLACE INTO loot_ledger (user_id, uid, src, created_at) VALUES (?, ?, ?, ?)', [userId, uid, src, now])
  }
}

/** 播种存量行囊并落标记(只在 loot_seed 无行时调用,竞态由主键幂等兜住) */
export async function seedLoot(userId: number, uids: readonly string[]): Promise<void> {
  await recordLoot(userId, uids, 'seed')
  await run('REPLACE INTO loot_seed (user_id, seeded_at) VALUES (?, ?)', [userId, Date.now()])
}

/** 已离行囊的签发行不再占台账(装备化尘/分解后账随物走,台账不无限增长) */
export async function pruneLoot(userId: number, keepUids: ReadonlySet<string>): Promise<void> {
  const rows = await all<{ uid: string }>('SELECT uid FROM loot_ledger WHERE user_id = ?', [userId])
  for (const row of rows) {
    if (!keepUids.has(row.uid)) {
      await run('DELETE FROM loot_ledger WHERE user_id = ? AND uid = ?', [userId, row.uid])
    }
  }
}

/** 验源留痕:走 save_flags(kind=loot),不抽稀不节流 —— 移除件是硬信息,GM 须逐条可见 */
export async function auditLootStrip(userId: number, data: Record<string, unknown>, stripped: number): Promise<void> {
  const player = (typeof data.player === 'object' && data.player !== null ? data.player : {}) as Record<string, unknown>
  const major = typeof player.major === 'number' && Number.isFinite(player.major) ? Math.trunc(player.major) : 0
  const sub = typeof player.sub === 'number' && Number.isFinite(player.sub) ? Math.trunc(player.sub) : 0
  const name = typeof player.name === 'string' ? player.name.slice(0, 24) : ''
  await run('INSERT INTO save_flags (user_id, name, kind, detail, realm_index, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
    userId,
    name,
    'loot',
    `非签发装备移除 ×${stripped}`,
    major * 100 + sub,
    Date.now()
  ])
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function uidOf(item: unknown): string | null {
  if (!isPlainObject(item)) return null
  const uid = item.uid
  return typeof uid === 'string' && uid !== '' && uid.length <= 64 ? uid : null
}

/**
 * 装备验源(落库前调用,归一化之后、复算/权威化之前 —— 移除件不该算进战力复算):
 *  - 首传(loot_seed 无行):行囊现有 uid 一次性播种入账,此后只认签发;
 *  - 已播种:不在台账的件从行囊移除(含 equipped 里指向它们的引用),留痕 + 清账。
 * 验源失败(库不可用)按原样返回 —— 加固不拒收,失败会在 GM 后台的复算/审计侧显形。
 */
export async function enforceLootProvenance(
  userId: number,
  data: Record<string, unknown>
): Promise<{ data: Record<string, unknown>; stripped: number }> {
  try {
    const { seeded, known } = await lootProvenance(userId)
    const inv = isPlainObject(data.inventory) ? data.inventory : null
    const rawItems = inv !== null && Array.isArray(inv.items) ? inv.items : []
    const items = rawItems.map(uidOf)
    if (!seeded) {
      const uids = items.filter((u): u is string => u !== null)
      await seedLoot(userId, uids)
      return { data, stripped: 0 }
    }
    const keptItems: unknown[] = []
    const keepUids = new Set<string>()
    let stripped = 0
    for (const item of rawItems) {
      const uid = uidOf(item)
      if (uid !== null && known.has(uid)) {
        keptItems.push(item)
        keepUids.add(uid)
      } else {
        stripped += 1
      }
    }
    if (stripped > 0 && inv !== null) {
      // equipped 里指向被移除件的引用一并清掉(同 uid 双挂会算两份属性)
      const equipped: Record<string, unknown> = {}
      if (isPlainObject(inv.equipped)) {
        for (const [slot, uid] of Object.entries(inv.equipped)) {
          if (typeof uid === 'string' && keepUids.has(uid)) equipped[slot] = uid
        }
      }
      const nextInv = { ...inv, items: keptItems, equipped }
      await auditLootStrip(userId, data, stripped)
      return { data: { ...data, inventory: nextInv }, stripped }
    }
    // 全部在账:顺手清掉已离行囊的签发行,台账不无限增长
    if (known.size > keepUids.size) await pruneLoot(userId, keepUids)
    return { data, stripped: 0 }
  } catch (err) {
    console.warn('[loot] 装备验源失败,按原样落库:', err instanceof Error ? err.message : err)
    return { data, stripped: 0 }
  }
}
