/**
 * 装备状态台账(1.58.3):行囊里每件装备的「等级 + 词条 + 封存 + 投入」以服务端为准。
 *
 * 为什么需要它:
 *   1.58.0 把**掉落**收进服务端签发(loot_ledger),但「已到手的那件怎么变强」仍全在客户端 ——
 *   console 把 level 改成上限、把词条换成完美组合,形状完全合法,saveSanitize 只能钳住
 *   「不超过上限」,钳不住「上限之内凭空得来」。现在强化/重铸/词条转移的唯一写入口是
 *   POST /api/forge/op,签发后把该件的新状态记在这里;上传存档时按台账覆盖客户端自报的值。
 *
 * 只管「原地改件」的七个字段:level / affixes / sealedAffixIds / reforgeCount / transferCount /
 * invested / quality。模板与阶数由签发时确定且无处可改,不重复保管;品质同样是签发时确定的,
 * 但它决定词条数上限与成色乘区 —— 不入账的话,改包把每件都写成最高品质就能白拿一整轮词条,
 * 故 1.66.2 起一并入账(旧行缺 quality 时不覆盖,随下一次 op/补登自然补上);
 * 装备/卸下、上锁这类不改变强度的操作也不走台账。
 *
 * 播种只此一次:存量档首次过账时把当时持有的件按当时状态入账(旧物来源无从考证,不追溯),
 * 标记落在 equip_seed 表 —— 删档重传不重播,否则「造一件 → 删档 → 重播」就是作弊环
 * (与 loot_seed 同思路)。
 */
import { all, get, run } from './db.js'

/** 台账里的一行:level 单列出来(最常看),其余打包进 state */
interface StateRow {
  uid: string
  level: number
  state: string
}

export interface EquipHoldings {
  seeded: boolean
  byUid: Map<string, { level: number; state: Record<string, unknown> }>
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function numOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

/**
 * 台账看住的那几个字段。
 * **字段名是与客户端的契约**:客户端 Core/forgeResolve.ts 头注写了同样一组,
 * 服务端不去动态加载客户端模块(那会让一次上传多一次 bundle 加载),两边改名要一起改。
 */
function stateOf(item: Record<string, unknown>): Record<string, unknown> {
  return {
    level: Math.max(0, Math.trunc(numOr(item.level, 0))),
    affixes: Array.isArray(item.affixes) ? item.affixes : [],
    sealedAffixIds: Array.isArray(item.sealedAffixIds) ? item.sealedAffixIds : [],
    reforgeCount: Math.max(0, Math.trunc(numOr(item.reforgeCount, 0))),
    transferCount: Math.max(0, Math.trunc(numOr(item.transferCount, 0))),
    invested: isPlainObject(item.invested) ? item.invested : { dust: 0, stone: { m: 0, e: 0 } },
    // 品质是签发时确定的权威值(掉落后无任何合法改动路径),入账后在覆盖时一并按台账回写;
    // 空串表示「这件入账时拿不到品质」(旧版补登),applyRow 见空串不覆盖
    quality: typeof item.quality === 'string' ? item.quality.slice(0, 24) : ''
  }
}

function parseState(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown
    return isPlainObject(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/** 读台账;未播种时 seeded=false(调用方按「首传」处理),但状态行照载 ——
 *  1.66.2 起签发(/loot/claim)即入状态账,播种必须能看到这些行,否则首传会把它们整批重播掉 */
export async function equipHoldings(userId: number): Promise<EquipHoldings> {
  const seededRow = await get<{ seeded_at: number }>('SELECT seeded_at FROM equip_seed WHERE user_id = ?', [userId])
  const rows = await all<StateRow>('SELECT uid, level, state FROM equip_state WHERE user_id = ?', [userId])
  const byUid = new Map<string, { level: number; state: Record<string, unknown> }>()
  for (const r of rows) byUid.set(r.uid, { level: r.level, state: parseState(r.state) })
  return { seeded: seededRow !== undefined, byUid }
}

/** 签发入账:同 uid 以最后一次签发为准(REPLACE 避免主键冲突把整批掷失败) */
export async function recordEquipStates(
  userId: number,
  entries: readonly { uid: string; level: number; state: unknown }[]
): Promise<void> {
  const now = Date.now()
  for (const e of entries) {
    if (typeof e.uid !== 'string' || e.uid === '' || e.uid.length > 64) continue
    const level = Number.isFinite(e.level) ? Math.max(0, Math.trunc(e.level)) : 0
    await run('REPLACE INTO equip_state (user_id, uid, level, state, updated_at) VALUES (?, ?, ?, ?, ?)', [
      userId,
      e.uid,
      level,
      JSON.stringify(e.state ?? {}),
      now
    ])
  }
}

/** 从一批整件里提取状态并入账(forge 路由签发后用:items 是客户端核心算出来的整件) */
export async function recordEquipStatesFromItems(userId: number, items: readonly unknown[]): Promise<void> {
  const entries: { uid: string; level: number; state: unknown }[] = []
  for (const raw of items) {
    if (!isPlainObject(raw)) continue
    const uid = typeof raw.uid === 'string' ? raw.uid : ''
    if (uid === '') continue
    const state = stateOf(raw)
    entries.push({ uid, level: numOr(state.level, 0), state })
  }
  if (entries.length > 0) await recordEquipStates(userId, entries)
}

/** 播种标记:只写一次(重复写用 REPLACE,值相同,幂等) */
export async function markEquipSeeded(userId: number): Promise<void> {
  await run('REPLACE INTO equip_seed (user_id, seeded_at) VALUES (?, ?)', [userId, Date.now()])
}

/** 清掉已不在档里的件(分解/出售/丢失),防台账随年月无限长 */
export async function pruneEquipStates(userId: number, keep: ReadonlySet<string>): Promise<void> {
  const rows = await all<{ uid: string }>('SELECT uid FROM equip_state WHERE user_id = ?', [userId])
  for (const r of rows) {
    if (!keep.has(r.uid)) await run('DELETE FROM equip_state WHERE user_id = ? AND uid = ?', [userId, r.uid])
  }
}

/*
 * 删档不清台账(1.66.3):与 loot_seed 同语义 —— 标记随号不随档。删档清掉播种标记
 * 会把状态台账退回「首传采信客户端」,旧 uid(loot_ledger 保留)配上改满的状态即可
 * 删档重传入账,成了可重复利用的注入链。新档行囊为空,孤儿行由 pruneEquipStates 清掉。
 */

/**
 * 回档专用:按档内现存的件**原值**重写台账(允许降级、删件),保留播种标记。
 * 理由同 levelLedger.resetLevelStatesFromData:台账不跟着回档,下一次上传就把
 * 强化等级与词条顶回回档前;而删 seed 标记会退回「首传采信客户端」。
 */
export async function resetEquipStatesFromData(userId: number, data: unknown): Promise<void> {
  const root = isPlainObject(data) ? data : null
  const inventory = root !== null && isPlainObject(root.inventory) ? root.inventory : null
  if (inventory === null) return
  const items = Array.isArray(inventory.items) ? inventory.items.filter(isPlainObject) : []
  const now = Date.now()
  await run('DELETE FROM equip_state WHERE user_id = ?', [userId])
  for (const item of items) {
    const uid = typeof item.uid === 'string' ? item.uid : ''
    if (uid === '' || uid.length > 64) continue
    const state = stateOf(item)
    await run('REPLACE INTO equip_state (user_id, uid, level, state, updated_at) VALUES (?, ?, ?, ?, ?)', [
      userId,
      uid,
      numOr(state.level, 0),
      JSON.stringify(state),
      now
    ])
  }
}

/** 台账状态套回档案里的一件;返回是否真的改过(用于留痕) */
function applyRow(item: Record<string, unknown>, row: { level: number; state: Record<string, unknown> }): boolean {
  // 台账行坏到没有 affixes(理论上不会:写入口只有 recordEquipStates)时整行跳过,
  // 宁可这一件按上传值走,也不要把它洗成「零词条」
  if (!Array.isArray(row.state.affixes)) return false
  const pick = (o: Record<string, unknown>): unknown[] => [
    o.level,
    o.affixes,
    o.sealedAffixIds,
    o.reforgeCount,
    o.transferCount,
    o.invested,
    o.quality
  ]
  const before = JSON.stringify(pick(item))
  item.level = row.level
  item.affixes = row.state.affixes
  item.sealedAffixIds = Array.isArray(row.state.sealedAffixIds) ? row.state.sealedAffixIds : []
  item.reforgeCount = numOr(row.state.reforgeCount, 0)
  item.transferCount = numOr(row.state.transferCount, 0)
  item.invested = isPlainObject(row.state.invested) ? row.state.invested : { dust: 0, stone: { m: 0, e: 0 } }
  // 品质按台账回写;旧行(1.66.2 前入账)没有 quality 字段时不动,留待下一次 op 补上
  if (typeof row.state.quality === 'string' && row.state.quality !== '') {
    item.quality = row.state.quality
  }
  return before !== JSON.stringify(pick(item))
}

/**
 * 上传时按台账覆盖装备状态。
 * 已播种的档:台账有的件一律以台账为准(不一致的件记一条留痕,只留痕不改档本身的数量);
 * 台账没有的件(签发侧漏记、或旧版本遗留)按上传状态当场补登,不改变本次内容。
 * 未播种的档:把当时持有的件按当时状态一次性入账 —— 存量档唯一一次「采信客户端」。
 */
export async function enforceEquipStates(
  userId: number,
  data: unknown
): Promise<{ data: unknown; corrected: string[] }> {
  const root = isPlainObject(data) ? data : null
  const inventory = root !== null && isPlainObject(root.inventory) ? root.inventory : null
  if (inventory === null || !Array.isArray(inventory.items)) return { data, corrected: [] }
  const items = inventory.items.filter(isPlainObject)
  if (items.length === 0) return { data, corrected: [] }

  const holdings = await equipHoldings(userId)

  if (!holdings.seeded) {
    const entries: { uid: string; level: number; state: unknown }[] = []
    for (const item of items) {
      const uid = typeof item.uid === 'string' ? item.uid : ''
      if (uid === '' || uid.length > 64) continue
      // 1.66.2 起签发(/loot/claim)即入状态账:已有行的件(签发时刚记的)不按上传重播 ——
      // 否则「领件 → 改满 → 首传」会在播种时把改满的样子照单入账,签发入账形同虚设。
      // 只补登台账里还没有的件(存量旧物),播种「唯一一次采信客户端」的语义不变。
      if (holdings.byUid.has(uid)) continue
      const state = stateOf(item)
      entries.push({ uid, level: typeof state.level === 'number' ? state.level : 0, state })
    }
    await recordEquipStates(userId, entries)
    await markEquipSeeded(userId)
    return { data, corrected: [] }
  }

  const corrected: string[] = []
  const missing: { uid: string; level: number; state: unknown }[] = []
  for (const item of items) {
    const uid = typeof item.uid === 'string' ? item.uid : ''
    if (uid === '' || uid.length > 64) continue
    const row = holdings.byUid.get(uid)
    if (row === undefined) {
      const state = stateOf(item)
      missing.push({ uid, level: typeof state.level === 'number' ? state.level : 0, state })
      continue
    }
    if (applyRow(item, row)) corrected.push(uid)
  }
  // 补登放在覆盖之后:同一批里不重复读库
  if (missing.length > 0) await recordEquipStates(userId, missing)
  return { data, corrected }
}
