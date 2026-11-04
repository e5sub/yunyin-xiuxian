/**
 * 等级台账(1.59.1):功法等级与洞府建筑等级以服务端为准。
 *
 * 为什么需要它:1.59.0 把「升级动作」收进了 POST /api/progress/op(算价/扣款/升级都在服务端),
 * 但 PUT /save 的分片本身仍可注入等级 —— sanitize 只钳「≤ 满级」,不问这级是怎么来的。
 * 现在升级签发时把新等级记在这里;上传存档时自报等级超出台账的一律按台账压回,
 * 拦的是「不调接口、直接改档」。与 equip_state(1.58.3)同构。
 *
 * 只记「等级」一个数:功法学到手(参悟)是客户端动作,新出现的功法按 1 级补登;
 * 建筑的 id 集合是固定的(BUILDINGS),首传播种时全部入账,此后缺行只可能是异常。
 *
 * 播种只此一次:存量档首次过账时按当时的等级入账(旧档来源无从考证,不追溯),
 * 标记落在 level_seed 表 —— 删档重传不重播,否则「练满 → 删档 → 重播」就是作弊环。
 * 等级永远只升不降(转世只减不增,见 reincarnation.carryGongfa),台账按「历史最高」记账。
 */
import { all, get, run } from './db.js'

export type LevelKind = 'gongfa' | 'building'

interface StateRow {
  kind: string
  item_id: string
  level: number
}

export interface LevelHoldings {
  seeded: boolean
  /** 键为 `${kind}:${item_id}` */
  levels: Map<string, number>
}

export interface LevelEntry {
  kind: LevelKind
  itemId: string
  level: number
}

function numOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function idOk(v: unknown): v is string {
  return typeof v === 'string' && v !== '' && v.length <= 64
}

/** 读台账;未播种时 seeded=false(调用方按「首传」处理) */
export async function levelHoldings(userId: number): Promise<LevelHoldings> {
  const seededRow = await get<{ seeded_at: number }>('SELECT seeded_at FROM level_seed WHERE user_id = ?', [userId])
  if (seededRow === undefined) return { seeded: false, levels: new Map() }
  const rows = await all<StateRow>('SELECT kind, item_id, level FROM level_state WHERE user_id = ?', [userId])
  const levels = new Map<string, number>()
  for (const r of rows) {
    if (r.kind !== 'gongfa' && r.kind !== 'building') continue
    levels.set(`${r.kind}:${r.item_id}`, r.level)
  }
  return { seeded: true, levels }
}

/** 入账:等级只抬不降(升级是唯一写入口,这里防御性地取历史最高) */
export async function recordLevelStates(userId: number, entries: readonly LevelEntry[]): Promise<void> {
  const now = Date.now()
  for (const e of entries) {
    if ((e.kind !== 'gongfa' && e.kind !== 'building') || !idOk(e.itemId)) continue
    const level = numOr(e.level, 0)
    if (level < 0) continue
    const prev = await get<{ level: number }>(
      'SELECT level FROM level_state WHERE user_id = ? AND kind = ? AND item_id = ?',
      [userId, e.kind, e.itemId]
    )
    const next = Math.max(level, prev?.level ?? 0)
    await run(
      'REPLACE INTO level_state (user_id, kind, item_id, level, updated_at) VALUES (?, ?, ?, ?, ?)',
      [userId, e.kind, e.itemId, next, now]
    )
  }
}

/** 播种标记:只写一次(重复写值相同,幂等) */
export async function markLevelsSeeded(userId: number): Promise<void> {
  await run('REPLACE INTO level_seed (user_id, seeded_at) VALUES (?, ?)', [userId, Date.now()])
}

/** 删档时一并清空(与 equip_state 同:删档即放弃这份修为,重开按新档播种) */
export async function clearLevelStates(userId: number): Promise<void> {
  await run('DELETE FROM level_state WHERE user_id = ?', [userId])
  await run('DELETE FROM level_seed WHERE user_id = ?', [userId])
}

/**
 * 上传时按台账压回等级。
 * 已播种的档:台账有的条目超出台账的按台账压;台账没有的功法按「至多 1 级」补登(参悟是客户端动作),
 * 建筑缺行按 0 压(建筑 id 固定,首传已全量入账,缺行只可能是异常)。
 * 未播种的档:把当时的等级一次性入账 —— 存量档唯一一次「采信客户端」。
 * 返回被压回的条目(留痕用);模块抛错由调用方兜底(加固环节不能变成拒收存档)。
 */
export async function enforceLevelStates(userId: number, data: unknown): Promise<string[]> {
  const root = typeof data === 'object' && data !== null && !Array.isArray(data) ? (data as Record<string, unknown>) : null
  if (root === null) return []
  const corrected: string[] = []
  const entries: LevelEntry[] = []

  const readLevels = (sliceName: string): Record<string, unknown> => {
    const slice = root[sliceName]
    if (typeof slice !== 'object' || slice === null || Array.isArray(slice)) return {}
    const raw = (slice as Record<string, unknown>).levels
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
    return raw as Record<string, unknown>
  }
  const readLearned = (): Record<string, unknown> => {
    const slice = root.cultivation
    if (typeof slice !== 'object' || slice === null || Array.isArray(slice)) return {}
    const raw = (slice as Record<string, unknown>).learned
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
    return raw as Record<string, unknown>
  }
  const setLevel = (sliceName: 'cultivation' | 'dongfu', key: 'learned' | 'levels', id: string, level: number): void => {
    const slice = root[sliceName] as Record<string, unknown>
    slice[key] = { ...(slice[key] as Record<string, unknown>), [id]: level }
  }

  const holdings = await levelHoldings(userId)

  if (!holdings.seeded) {
    for (const [id, lv] of Object.entries(readLearned())) {
      if (!idOk(id)) continue
      const level = Math.max(0, Math.trunc(numOr(lv, 0)))
      if (level > 0) entries.push({ kind: 'gongfa', itemId: id, level })
    }
    for (const [id, lv] of Object.entries(readLevels('dongfu'))) {
      if (!idOk(id)) continue
      entries.push({ kind: 'building', itemId: id, level: Math.max(0, Math.trunc(numOr(lv, 0))) })
    }
    await recordLevelStates(userId, entries)
    await markLevelsSeeded(userId)
    return []
  }

  for (const [id, lv] of Object.entries(readLearned())) {
    if (!idOk(id)) continue
    const level = Math.max(0, Math.trunc(numOr(lv, 0)))
    if (level <= 0) continue
    const ledger = holdings.levels.get(`gongfa:${id}`)
    // 台账没有的功法:参悟合法到手是 1 级,超出的部分压回(1.59.0 前的存量档已随播种入账)
    const allowed = ledger ?? 1
    if (level > allowed) {
      setLevel('cultivation', 'learned', id, allowed)
      corrected.push(`功法 ${id} 等级 ${level}→${allowed}`)
      if (ledger === undefined) entries.push({ kind: 'gongfa', itemId: id, level: allowed })
    }
  }
  for (const [id, lv] of Object.entries(readLevels('dongfu'))) {
    if (!idOk(id)) continue
    const level = Math.max(0, Math.trunc(numOr(lv, 0)))
    const ledger = holdings.levels.get(`building:${id}`)
    const allowed = ledger ?? 0
    if (level > allowed) {
      setLevel('dongfu', 'levels', id, allowed)
      corrected.push(`建筑 ${id} 等级 ${level}→${allowed}`)
    }
  }
  if (entries.length > 0) await recordLevelStates(userId, entries)
  return corrected
}
