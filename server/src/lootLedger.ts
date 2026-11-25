/**
 * 掉落台账:行囊里每件装备、每件法宝、每枚器魂,都须由服务端签发并记入 loot_ledger;
 * 上传存档时验源,非签发者移除并留痕(1.58.0 装备 / 1.58.1 法宝与器魂)。
 *
 * 键与类别(kind):
 *   equip     —— 装备实例 uid
 *   artifact  —— 法宝 defId(档里同 defId 只一件,defId 即身份)
 *   soul      —— 器魂 uid
 *
 * 播种只此一次:存量档首次过验源时把当时持有的三类物件一次性入账(旧物来源无从考证,
 * 不追溯);标记落在 loot_seed 表 —— 删档重传不重播,否则「造一件 → 删档 → 重播」就是作弊环。
 */
import { all, get, run } from './db.js'

export type LootKind = 'equip' | 'artifact' | 'soul'

export interface LootHoldings {
  seeded: boolean
  /** 各类别已签发的键 */
  known: Record<LootKind, Set<string>>
}

function emptyKnown(): Record<LootKind, Set<string>> {
  return { equip: new Set(), artifact: new Set(), soul: new Set() }
}

/** 三类物件的已签发键;玩家删除存档不重播种子,台账随签到删 */
export async function lootProvenance(userId: number): Promise<LootHoldings> {
  const seededRow = await get<{ seeded_at: number }>('SELECT seeded_at FROM loot_seed WHERE user_id = ?', [userId])
  if (seededRow === undefined) return { seeded: false, known: emptyKnown() }
  const rows = await all<{ uid: string; kind: string }>('SELECT uid, kind FROM loot_ledger WHERE user_id = ?', [userId])
  const known = emptyKnown()
  for (const r of rows) {
    const kind = r.kind === 'artifact' || r.kind === 'soul' ? r.kind : 'equip'
    known[kind].add(r.uid)
  }
  return { seeded: true, known }
}

/** 签发入账:批量记台账(src 记来源,便于 GM 追数量异常) */
export async function recordLoot(
  userId: number,
  keys: readonly string[],
  src: string,
  kind: LootKind = 'equip'
): Promise<void> {
  const now = Date.now()
  for (const key of keys) {
    if (typeof key !== 'string' || key === '' || key.length > 64) continue
    // REPLACE:同键重签(理论不该发生)以最后一次为准,不因主键冲突把整批掷失败
    await run('REPLACE INTO loot_ledger (user_id, uid, src, created_at, kind) VALUES (?, ?, ?, ?, ?)', [
      userId,
      key,
      src,
      now,
      kind
    ])
  }
}

/** 播种存量持有并落标记(只在 loot_seed 无行时调用,竞态由主键幂等兜住) */
export async function seedLoot(
  userId: number,
  holdings: { equips: readonly string[]; artifacts: readonly string[]; souls: readonly string[] }
): Promise<void> {
  /*
   * 播种件数上限(1.77.0):首传是「唯一一次采信客户端」的窗口,数量也该有顶 ——
   * 行囊容量/法宝表/器魂槽本来就是玩法硬界,超出的部分只能是无账之件,不播。
   */
  const SEED_CAPS = { equip: 300, artifact: 60, soul: 120 } as const
  await recordLoot(userId, holdings.equips.slice(0, SEED_CAPS.equip), 'seed', 'equip')
  await recordLoot(userId, holdings.artifacts.slice(0, SEED_CAPS.artifact), 'seed', 'artifact')
  await recordLoot(userId, holdings.souls.slice(0, SEED_CAPS.soul), 'seed', 'soul')
  await run('REPLACE INTO loot_seed (user_id, seeded_at) VALUES (?, ?)', [userId, Date.now()])
}

/* ---------------- 器魂烧炼账(1.66.3) ----------------
 *
 * 凝炼的语义是「烧一件装备、品质决定魂阶」,但 /loot/extras 的签发在原器离开云档之前
 * (客户端是先签发、后移除、再随上传落库)—— 服务端若不记账,同一件在「签发 → 上传」
 * 的窗口里能被反复凝炼刷魂。soul_burns 以原器 uid 记一笔,同 uid 只认一魂;
 * 上传落库后原器已离手,行随行囊瘦身清掉。
 */

/** 已烧过的原器 uid 集合(只查请求里带到的那些,避免整表回读) */
export async function burnedSoulUids(userId: number, uids: readonly string[]): Promise<Set<string>> {
  const out = new Set<string>()
  for (const uid of uids) {
    const row = await get<{ uid: string }>('SELECT uid FROM soul_burns WHERE user_id = ? AND uid = ?', [userId, uid])
    if (row !== undefined) out.add(uid)
  }
  return out
}

/** 原器烧炼入账(同 uid 幂等,重复烧同件不重复记账) */
export async function recordSoulBurns(userId: number, uids: readonly string[]): Promise<void> {
  const now = Date.now()
  for (const uid of uids) {
    if (typeof uid !== 'string' || uid === '' || uid.length > 64) continue
    await run('REPLACE INTO soul_burns (user_id, uid, created_at) VALUES (?, ?, ?)', [userId, uid, now])
  }
}

/** 原器已随上传离手(不在行囊里了):烧炼账清行,防表随年月增长 */
export async function pruneSoulBurns(userId: number, keep: ReadonlySet<string>): Promise<void> {
  const rows = await all<{ uid: string }>('SELECT uid FROM soul_burns WHERE user_id = ?', [userId])
  for (const r of rows) {
    if (!keep.has(r.uid)) await run('DELETE FROM soul_burns WHERE user_id = ? AND uid = ?', [userId, r.uid])
  }
}

/** 已离手的签发行不再占台账(装备化尘/分解、法宝重复折悟道、器魂装配后消失都在此清账) */export async function pruneLoot(userId: number, keep: Record<LootKind, ReadonlySet<string>>): Promise<void> {
  const rows = await all<{ uid: string; kind: string }>('SELECT uid, kind FROM loot_ledger WHERE user_id = ?', [userId])
  for (const row of rows) {
    const kind: LootKind = row.kind === 'artifact' || row.kind === 'soul' ? row.kind : 'equip'
    if (!keep[kind].has(row.uid)) {
      await run('DELETE FROM loot_ledger WHERE user_id = ? AND uid = ?', [userId, row.uid])
    }
  }
}

/** 验源留痕:走 save_flags(kind=loot),不抽稀不节流 —— 移除件是硬信息,GM 须逐条可见 */
export async function auditLootStrip(
  userId: number,
  data: Record<string, unknown>,
  stripped: number,
  detail = '非签发装备'
): Promise<void> {
  const player = (typeof data.player === 'object' && data.player !== null ? data.player : {}) as Record<string, unknown>
  const major = typeof player.major === 'number' && Number.isFinite(player.major) ? Math.trunc(player.major) : 0
  const sub = typeof player.sub === 'number' && Number.isFinite(player.sub) ? Math.trunc(player.sub) : 0
  const name = typeof player.name === 'string' ? player.name.slice(0, 24) : ''
  await run('INSERT INTO save_flags (user_id, name, kind, detail, realm_index, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
    userId,
    name,
    'loot',
    `${detail}移除 ×${stripped}`.slice(0, 255),
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
 * 验源(落库前调用,归一化之后、复算/权威化之前 —— 移除件不该算进战力复算):
 *  - 首传(loot_seed 无行):把行囊装备、法宝、器魂一次性播种入账,此后只认签发;
 *  - 已播种:不在台账的物件移除(装备连 equipped 引用一并清),留痕 + 清账。
 * 验源失败(库不可用)按原样返回 —— 加固不拒收,失败会在 GM 后台的复算/审计侧显形。
 */
export async function enforceLootProvenance(
  userId: number,
  data: Record<string, unknown>
): Promise<{ data: Record<string, unknown>; stripped: number }> {
  try {
    const { seeded, known } = await lootProvenance(userId)
    const inv = isPlainObject(data.inventory) ? data.inventory : null
    const endgame = isPlainObject(data.endgame) ? data.endgame : null
    const rawItems = inv !== null && Array.isArray(inv.items) ? inv.items : []
    const rawArtifacts = inv !== null && Array.isArray(inv.artifacts) ? inv.artifacts : []
    const rawSouls = endgame !== null && Array.isArray(endgame.souls) ? endgame.souls : []

    const artifactIdOf = (a: unknown): string | null => {
      if (!isPlainObject(a)) return null
      const defId = a.defId
      return typeof defId === 'string' && defId !== '' && defId.length <= 64 ? defId : null
    }

    if (!seeded) {
      await seedLoot(userId, {
        equips: rawItems.map(uidOf).filter((u): u is string => u !== null),
        artifacts: rawArtifacts.map(artifactIdOf).filter((u): u is string => u !== null),
        souls: rawSouls.map(uidOf).filter((u): u is string => u !== null)
      })
      return { data, stripped: 0 }
    }

    // 装备
    const keptItems: unknown[] = []
    let strippedEquips = 0
    for (const item of rawItems) {
      const uid = uidOf(item)
      if (uid !== null && known.equip.has(uid)) keptItems.push(item)
      else strippedEquips += 1
    }
    // 法宝
    const keptArtifacts: unknown[] = []
    let strippedArtifacts = 0
    for (const art of rawArtifacts) {
      const defId = artifactIdOf(art)
      if (defId !== null && known.artifact.has(defId)) keptArtifacts.push(art)
      else strippedArtifacts += 1
    }
    // 器魂
    const keptSouls: unknown[] = []
    let strippedSouls = 0
    for (const soul of rawSouls) {
      const uid = uidOf(soul)
      if (uid !== null && known.soul.has(uid)) keptSouls.push(soul)
      else strippedSouls += 1
    }
    const stripped = strippedEquips + strippedArtifacts + strippedSouls
    /*
     * 已离手的签发行一律清账,不只在「干净轮」清(1.66.3 专项扫描第二轮):
     * 剥离轮里跳过 prune 会让「本轮离手的合法件」的签发行多活一轮,而 equip_state
     * 每轮都按 keep 清 —— 错位窗口里把已出售件塞回档:签发行还在(过验源)、
     * 状态行已清,补登路径当场采信上传,强化注入得手。清账失败走外层兜底按原样落库。
     */
    await pruneLoot(userId, {
      equip: new Set(keptItems.map(uidOf).filter((u): u is string => u !== null)),
      artifact: new Set(keptArtifacts.map(artifactIdOf).filter((u): u is string => u !== null)),
      soul: new Set(keptSouls.map(uidOf).filter((u): u is string => u !== null))
    })
    if (stripped === 0) {
      return { data, stripped: 0 }
    }

    const keepUids = new Set(keptItems.map(uidOf).filter((u): u is string => u !== null))
    let nextInventory = inv
    if (inv !== null && (strippedEquips > 0 || strippedArtifacts > 0)) {
      // equipped 里指向被移除件的引用一并清掉(同 uid 双挂会算两份属性)
      const equipped: Record<string, unknown> = {}
      if (isPlainObject(inv.equipped)) {
        for (const [slot, uid] of Object.entries(inv.equipped)) {
          if (typeof uid === 'string' && keepUids.has(uid)) equipped[slot] = uid
        }
      }
      nextInventory = {
        ...inv,
        items: keptItems,
        artifacts: keptArtifacts,
        ...(strippedEquips > 0 ? { equipped } : {})
      }
    }
    // 器魂的装配位指向被移除的魂,一并清掉
    let nextEndgame = endgame
    if (endgame !== null && strippedSouls > 0) {
      const soulUids = new Set(keptSouls.map(uidOf).filter((u): u is string => u !== null))
      const equippedSouls = Array.isArray(endgame.equippedSouls)
        ? endgame.equippedSouls.filter(s => typeof s === 'string' && soulUids.has(s))
        : []
      nextEndgame = { ...endgame, souls: keptSouls, equippedSouls }
    }
    if (strippedEquips > 0) await auditLootStrip(userId, data, strippedEquips, '非签发装备')
    if (strippedArtifacts > 0) await auditLootStrip(userId, data, strippedArtifacts, '非签发法宝')
    if (strippedSouls > 0) await auditLootStrip(userId, data, strippedSouls, '非签发器魂')
    return {
      data: { ...data, ...(nextInventory !== null ? { inventory: nextInventory } : {}), ...(nextEndgame !== null ? { endgame: nextEndgame } : {}) },
      stripped
    }
  } catch (err) {
    console.warn('[loot] 装备验源失败,按原样落库:', err instanceof Error ? err.message : err)
    return { data, stripped: 0 }
  }
}

/* ------------------------------------------------------------------ *
 * 掉落件数账(1.74.1):镇压/离线的装备件数原是客户端自报,只有单次钳制
 * (SUPPRESS_COUNT_CAP/OFFLINE_COUNT_CAP)兜着 —— 改包每 300ms 报一次满额
 * count,单次钳形同虚设,一小时能签几百件(正常期望 ~10 件/时)。
 * 现记「上次同类结算时刻」,件数上限按距上次的真实时长推算;没有历史行的
 * 首次采信一次(种子),此后全按真实间隔。
 * ------------------------------------------------------------------ */

export interface LootBudgetLimit {
  /** 每小时可签发件数(与客户端的期望产速同源) */
  ratePerHour: number
  /** 积攒封顶(长离线后一次结算的天花板) */
  cap: number
}

/** 取走本次配额:返回实际允许签发的件数(≤ want),并把「上次结算」推到 now */
export async function takeLootBudget(
  userId: number,
  src: string,
  want: number,
  now: number,
  lim: LootBudgetLimit
): Promise<number> {
  if (want <= 0) return 0
  const row = await get<{ updated_at: number }>(
    'SELECT updated_at FROM loot_budgets WHERE user_id = ? AND src = ?',
    [userId, src]
  )
  let allow: number
  if (row === undefined) {
    // 首次采信:只此一次,之后全按真实间隔推
    allow = Math.min(want, lim.cap)
  } else {
    const gapHours = Math.max(0, (now - row.updated_at) / 3_600_000)
    allow = Math.min(Math.floor(lim.ratePerHour * gapHours), lim.cap, want)
  }
  await run('REPLACE INTO loot_budgets (user_id, src, updated_at) VALUES (?, ?, ?)', [userId, src, now])
  return allow
}
