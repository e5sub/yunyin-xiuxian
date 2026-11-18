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

/**
 * 台账记账的三类:
 *  - gongfa / building:1.59.1 起(功法学到手与建筑等级)
 *  - artifact:1.67.0 起(法宝祭炼重数,itemId 是 defId)—— 此前 artifacts[] 完全没有台账,
 *    改档把重数写成满重就能白拿永久被动
 *  - vein:1.67.0 起(灵脉投点,itemId 是 VeinId)—— 点数既进服务端算价(悟道点折扣),
 *    又是采集加成与祭炼折扣的底数,此前可改档写满 100 点
 */
export type LevelKind = 'gongfa' | 'building' | 'artifact' | 'vein'

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
    if (r.kind !== 'gongfa' && r.kind !== 'building' && r.kind !== 'artifact' && r.kind !== 'vein') continue
    levels.set(`${r.kind}:${r.item_id}`, r.level)
  }
  return { seeded: true, levels }
}

/** 入账:等级只抬不降(升级是唯一写入口,这里防御性地取历史最高) */
export async function recordLevelStates(userId: number, entries: readonly LevelEntry[]): Promise<void> {
  const now = Date.now()
  for (const e of entries) {
    if (
      (e.kind !== 'gongfa' && e.kind !== 'building' && e.kind !== 'artifact' && e.kind !== 'vein') ||
      !idOk(e.itemId)
    )
      continue
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

/*
 * 删档不清台账(1.66.3):与 loot_seed 同语义 —— 标记随号不随档。删档清掉播种标记
 * 会把等级台账退回「首传采信客户端」,删档重传即可注入满级功法/建筑,且每删一次
 * 重置一次。台账只升不降:对删档后的新档,旧行只有「钳住注水等级」的作用。
 */

/**
 * 回档专用:按档内等级**原值**重写台账(允许下调),但保留播种标记。
 *
 * enforceLevelStates 的「只升不降」是防直注,可回档是服务端自己把档换回旧版本:
 * 台账不跟着降,下一次上传就按台账把旧档的等级顶回回档前,回档等于没回。
 * 这里也不删 seed 标记 —— 删了就会走「首传采信客户端」,反而给改档留窗口。
 */
export async function resetLevelStatesFromData(userId: number, data: unknown): Promise<void> {
  const root = typeof data === 'object' && data !== null && !Array.isArray(data) ? (data as Record<string, unknown>) : null
  if (root === null) return
  const pickLevels = (sliceName: string): Record<string, unknown> => {
    const slice = root[sliceName]
    if (typeof slice !== 'object' || slice === null || Array.isArray(slice)) return {}
    const raw = (slice as Record<string, unknown>).levels
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
    return raw as Record<string, unknown>
  }
  const pickLearned = (): Record<string, unknown> => {
    const slice = root.cultivation
    if (typeof slice !== 'object' || slice === null || Array.isArray(slice)) return {}
    const raw = (slice as Record<string, unknown>).learned
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
    return raw as Record<string, unknown>
  }
  const pickVeins = (): Record<string, unknown> => {
    const slice = root.dongfu
    if (typeof slice !== 'object' || slice === null || Array.isArray(slice)) return {}
    const raw = (slice as Record<string, unknown>).veinPoints
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
    return raw as Record<string, unknown>
  }
  const pickArtifacts = (): { defId: string; level: number }[] => {
    const slice = root.inventory
    if (typeof slice !== 'object' || slice === null || Array.isArray(slice)) return []
    const list = (slice as Record<string, unknown>).artifacts
    if (!Array.isArray(list)) return []
    const out: { defId: string; level: number }[] = []
    for (const raw of list) {
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue
      const o = raw as Record<string, unknown>
      const defId = typeof o.defId === 'string' ? o.defId : ''
      if (!idOk(defId)) continue
      out.push({ defId, level: Math.max(0, Math.trunc(numOr(o.level, 0))) })
    }
    return out
  }
  const now = Date.now()
  await run('DELETE FROM level_state WHERE user_id = ?', [userId])
  for (const [id, lv] of Object.entries(pickLearned())) {
    if (!idOk(id)) continue
    const level = Math.max(0, Math.trunc(numOr(lv, 0)))
    if (level <= 0) continue
    await run('REPLACE INTO level_state (user_id, kind, item_id, level, updated_at) VALUES (?, ?, ?, ?, ?)', [
      userId,
      'gongfa',
      id,
      level,
      now
    ])
  }
  for (const [id, lv] of Object.entries(pickLevels('dongfu'))) {
    if (!idOk(id)) continue
    await run('REPLACE INTO level_state (user_id, kind, item_id, level, updated_at) VALUES (?, ?, ?, ?, ?)', [
      userId,
      'building',
      id,
      Math.max(0, Math.trunc(numOr(lv, 0))),
      now
    ])
  }
  for (const [id, pts] of Object.entries(pickVeins())) {
    if (!idOk(id)) continue
    await run('REPLACE INTO level_state (user_id, kind, item_id, level, updated_at) VALUES (?, ?, ?, ?, ?)', [
      userId,
      'vein',
      id,
      Math.max(0, Math.trunc(numOr(pts, 0))),
      now
    ])
  }
  for (const art of pickArtifacts()) {
    if (!idOk(art.defId)) continue
    await run('REPLACE INTO level_state (user_id, kind, item_id, level, updated_at) VALUES (?, ?, ?, ?, ?)', [
      userId,
      'artifact',
      art.defId,
      art.level,
      now
    ])
  }
}

/**
 * 上传时按台账压回等级。
 * 已播种的档:台账有的条目超出台账的按台账压;台账没有的功法分三种(1.67.0):
 *   · 上次的档里已有 → 历史既成(事件/开局送的),按「至多 1 级」保留;
 *   · 上次没有、本次新出现 → 每次上传至多 1 部(正常只会是参悟或际遇,一次一部),
 *     多出来的直接删条目 —— 否则「一次塞满 79 门功法」就等于每门白拿 1 级被动;
 *   · 参悟本身已上服务端(POST /api/progress/op 的 gongfaLearn),走台账,不占上面这条。
 * 建筑缺行按 0 压(建筑 id 固定,首传已全量入账,缺行只可能是异常)。
 * 未播种的档:把当时的等级一次性入账 —— 存量档唯一一次「采信客户端」。
 * 返回被压回的条目(留痕用);模块抛错由调用方兜底(加固环节不能变成拒收存档)。
 */
export async function enforceLevelStates(userId: number, data: unknown, prev?: unknown): Promise<string[]> {
  const root = typeof data === 'object' && data !== null && !Array.isArray(data) ? (data as Record<string, unknown>) : null
  if (root === null) return []
  const corrected: string[] = []
  const entries: LevelEntry[] = []
  /** 上次落库档里已学的功法:用来区分「既成历史」与「本次新塞」 */
  const prevRoot = typeof prev === 'object' && prev !== null && !Array.isArray(prev) ? (prev as Record<string, unknown>) : null
  const prevCult = prevRoot !== null && typeof prevRoot.cultivation === 'object' && prevRoot.cultivation !== null
    ? (prevRoot.cultivation as Record<string, unknown>)
    : null
  const prevLearned = new Set(
    prevCult !== null && typeof prevCult.learned === 'object' && prevCult.learned !== null
      ? Object.keys(prevCult.learned as Record<string, unknown>)
      : []
  )
  /** 本次新出现(台账外)的功法计数:一次上传只放行一部 */
  let newlySeen = 0

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
  /** 灵脉点数:dongfu.veinPoints(1.67.0) */
  const readVeins = (): { id: string; points: number }[] => {
    const slice = root.dongfu
    if (typeof slice !== 'object' || slice === null || Array.isArray(slice)) return []
    const raw = (slice as Record<string, unknown>).veinPoints
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return []
    const out: { id: string; points: number }[] = []
    for (const [id, pts] of Object.entries(raw as Record<string, unknown>)) {
      if (!idOk(id)) continue
      out.push({ id, points: Math.max(0, Math.trunc(numOr(pts, 0))) })
    }
    return out
  }
  /** 法宝重数:inventory.artifacts(1.67.0) */
  const readArtifacts = (): { defId: string; level: number }[] => {
    const slice = root.inventory
    if (typeof slice !== 'object' || slice === null || Array.isArray(slice)) return []
    const list = (slice as Record<string, unknown>).artifacts
    if (!Array.isArray(list)) return []
    const out: { defId: string; level: number }[] = []
    for (const raw of list) {
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue
      const o = raw as Record<string, unknown>
      const defId = typeof o.defId === 'string' ? o.defId : ''
      if (!idOk(defId)) continue
      out.push({ defId, level: Math.max(0, Math.trunc(numOr(o.level, 0))) })
    }
    return out
  }
  const setLevel = (sliceName: 'cultivation' | 'dongfu', key: 'learned' | 'levels', id: string, level: number): void => {
    const slice = root[sliceName] as Record<string, unknown>
    const map = { ...((slice[key] as Record<string, unknown>) ?? {}) }
    // 0 级等于「没学」:直接删条目而不是写 0,免得存档里留下一条空壳(客户端 sanitize 会删,但落库也该干净)
    if (level > 0) map[id] = level
    else delete map[id]
    slice[key] = map
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
    for (const art of readArtifacts()) {
      entries.push({ kind: 'artifact', itemId: art.defId, level: art.level })
    }
    for (const v of readVeins()) {
      entries.push({ kind: 'vein', itemId: v.id, level: v.points })
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
    let allowed: number
    if (ledger !== undefined) {
      allowed = ledger
    } else if (prevLearned.has(id)) {
      // 上次的档里已经学过:历史既成(际遇/开局所授),只压到「参悟到手的 1 级」,
      // 不删 —— 老档若在校验上线前把等级练高了,这里也不会把人家的功法连根拔掉
      allowed = Math.min(1, level)
    } else if (newlySeen < 1) {
      // 本次新出现且台账里没有:正常只可能是「际遇刚送了一部」,一次上传放行一部
      allowed = Math.min(1, level)
      newlySeen += 1
    } else {
      // 一次塞进来的第二部起:删条目(0 级 = 没学),它没有任何出处
      allowed = 0
    }
    if (level !== allowed) {
      setLevel('cultivation', 'learned', id, allowed)
      corrected.push(`功法 ${id} 等级 ${level}→${allowed}`)
      if (allowed === 1 && ledger === undefined) entries.push({ kind: 'gongfa', itemId: id, level: 1 })
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
  /*
   * 法宝重数(1.67.0):台账没有这件的一律压到 0 —— 与功法不同,法宝是 loot_ledger 逐件签发的
   * (defId 有出处),所以「台账里没有」只可能是「签发之后改重数」或旧版补登;
   * 前者该压,后者由播种或下一次祭炼 op 补上。压回时把整条 artifacts 重写,不留半个字段。
   */
  /*
   * 灵脉点数(1.67.0):台账没有的脉压到 0,超出台账的压回台账值。与建筑同规 ——
   * 投点是单调的(没有退还路径),台账「只升不降」在这里天然成立。
   */
  const veins = readVeins()
  if (veins.length > 0) {
    const slice = root.dongfu as Record<string, unknown>
    const map = { ...((slice.veinPoints as Record<string, unknown>) ?? {}) }
    let touched = false
    for (const v of veins) {
      const allowed = holdings.levels.get(`vein:${v.id}`) ?? 0
      if (v.points > allowed) {
        map[v.id] = allowed
        touched = true
        corrected.push(`灵脉 ${v.id} 点数 ${v.points}→${allowed}`)
      }
    }
    if (touched) slice.veinPoints = map
  }
  const arts = readArtifacts()
  if (arts.length > 0) {
    const inv = root.inventory as Record<string, unknown>
    const fixed = arts.map(a => {
      const allowed = holdings.levels.get(`artifact:${a.defId}`) ?? 0
      if (a.level > allowed) corrected.push(`法宝 ${a.defId} 重数 ${a.level}→${allowed}`)
      return { defId: a.defId, level: Math.min(a.level, allowed) }
    })
    // 只改 level:artifacts 里可能还有别的版本字段,整条替换会丢
    const rawList = inv.artifacts as unknown[]
    inv.artifacts = rawList.map(raw => {
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw
      const o = raw as Record<string, unknown>
      const defId = typeof o.defId === 'string' ? o.defId : ''
      const hit = fixed.find(f => f.defId === defId)
      return hit === undefined ? raw : { ...o, level: hit.level }
    })
  }
  if (entries.length > 0) await recordLevelStates(userId, entries)
  return corrected
}

/**
 * 清空某一类的台账(1.74.1:灵脉重置)。
 *
 * 灵脉重置把四脉点数全数归零,台账若不跟着清,上传一次旧点数就被「只升不降」
 * 的 enforceLevelStates 顶回档里 —— 重置等于白买。这里只删行不动播种标记:
 * 重置是**降级**不是删档,首传采信那扇门不能因此重开。
 */
export async function clearLevelKind(userId: number, kind: 'vein'): Promise<void> {
  await run('DELETE FROM level_state WHERE user_id = ? AND kind = ?', [userId, kind])
}
