/**
 * 门派仓储(服务端独占):门派本体 + 门人关系 + 入派申请 + 捐献支出账。
 *
 * **为什么门派不进存档分片。**
 * 1.66.x 之前那些「改档换战力」的漏口,根子都在「字段可本地写」。门派要给的恰恰是永久属性
 * (技能与建筑都进 finalStats),而它的来源是一枚新货币(门派/个人贡献)。若把这份状态放进存档:
 *    · 贡献数可本地写 → 捐一次改一笔,或直接把个人贡献填到 10 万;
 *    · 建筑等级与工期可本地写 → 免贡献、免等待;
 *    · 台账只能事后压回,而「已经学到的技能」那一瞬间的收益是压不回来的。
 * 所以整份状态只住这三张表:客户端读 (GET /api/sect) 只拿到一份拷贝,写只提交动作
 * (建派 / 申请 / 审批 / 捐什么 / 升哪座 / 学哪门),算价与计时全在服务端跑 core/sectRules。
 * 上传存档时服务端**不读**客户端对门派的任何声明 —— 攻击面为零。
 *
 * **1.69.0 起一人一派变成一份门派多个门人。** 于是状态拆成两半:
 *    · `sects`         门派本体(公账):道统、门派名、门派库、技能、建筑、营造任务;
 *    · `sect_members`  门人(私账):我在本门的身份、个人贡献、日限次、累计捐献。
 * 一个玩家看到的 `SectState` 是两者拼起来的(readSettledSectState 负责这件事),
 * 客户端不必知道分了几张表 —— 这也是 profileRecompute 能原样吃下这份状态的原因。
 *
 * **捐献怎么保证付了钱。**
 * 与 forge_spend / progress_spend 同一套:动作在服务端记账(sect_spend),扣款写在客户端。
 * 但门派多一道前置校验 —— 捐献之前先读**云档快照**里的资源余额,减去「上次上传后尚未兑现的
 * 捐献」,不够就拒。这样「余额为 0 反复捐」这条免费通道被堵住(见 routes/sect.ts 的 affordable)。
 * 记账本身仍要留:下一次上传时 core/saveAuthority 会按这本账扣资源可增长量,
 * 改包把资源填满也留不下来。
 */
import { all, get, run, upsertByPk } from './db.js'
import { loadClientModule } from './clientVendor.js'

const SOURCE_MODULE = '../../src/core/sectRules'
const VENDOR_FILE = 'sectRules'

export type SectRole = 'leader' | 'deputy' | 'elder' | 'member'

/** 合法身份表(与 core/sectRules 的 SECT_ROLES 同一份清单,服务端另写一份不 import) */
export const SECT_ROLES: readonly SectRole[] = ['leader', 'deputy', 'elder', 'member']

/** 库里的 role 字段是否认识(手工改库/旧行兜底) */
export function isSectRole(v: unknown): v is SectRole {
  return (SECT_ROLES as readonly unknown[]).includes(v)
}

/**
 * 状态的线上形状(core/sectRules 的 SectState)。这里另写一份而不是 import:
 * 服务端 tsc 跟进客户端模块会把整个 src 图卷进类型检查,`@/` 别名与 DOM 差异全是假错
 * (与 saveAuthority / levelResolve 的处理一致)。
 */
export interface SectState {
  name: string
  personal: number
  pool: number
  skills: Record<string, number>
  /** 门派绝学(1.74.1):id → 重数(0~5);归一化在 core/sectRules.normalizeSectState */
  arts: Record<string, number>
  buildings: Record<string, number>
  build: { id: string; to: number; startAt: number; finishAt: number }[]
  day: string
  donationsToday: number
  totalDonated: number
  role: SectRole | null
  memberCount: number
}

interface SectRulesModule {
  normalizeSectState: (raw: unknown, now: number) => SectState
  settleBuild: (state: SectState, now: number) => { state: SectState; done: string[] }
  emptySectState: () => SectState
}

let cached: Promise<SectRulesModule> | null = null

/** 与其它权威链同规:加载失败不缓存 rejected promise(部署事故修好后不该等重启) */
function rules(): Promise<SectRulesModule> {
  cached ??= loadClientModule<SectRulesModule>(SOURCE_MODULE, VENDOR_FILE)
  cached.catch(() => {
    cached = null
  })
  return cached
}

export async function emptyState(): Promise<SectState> {
  const mod = await rules()
  return mod.emptySectState()
}

/* ---------------- 行形状 ---------------- */

export interface SectRow {
  id: number
  name: string
  leader_uid: number
  data: string
  created_at: number
}

export interface SectMemberRow {
  user_id: number
  sect_row: number
  role: string
  personal: number
  day: string
  donations_today: number
  total_donated: number
  joined_at: number
}

export interface SectApplyRow {
  user_id: number
  sect_row: number
  created_at: number
}

export interface SectMemberView {
  userId: number
  name: string
  role: SectRole
  personal: number
  totalDonated: number
  joinedAt: number
}

export interface SectApplyView {
  userId: number
  name: string
  realmLabel: string
  realmIndex: number
  at: number
}

export interface SectBriefView {
  id: number
  name: string
  leader: string
  members: number
  cap: number
  hall: number
}

/** 读原始行(不做修形);没有 → null */
export async function readBody(sectRow: number): Promise<SectRow | null> {
  const row = await get<SectRow>('SELECT id, name, leader_uid, data, created_at FROM sects WHERE id = ?', [sectRow])
  return row ?? null
}

export async function readMember(userId: number): Promise<SectMemberRow | null> {
  const row = await get<SectMemberRow>(
    'SELECT user_id, sect_row, role, personal, day, donations_today, total_donated, joined_at FROM sect_members WHERE user_id = ?',
    [userId]
  )
  return row ?? null
}

export async function readApply(userId: number): Promise<SectApplyRow | null> {
  const row = await get<SectApplyRow>('SELECT user_id, sect_row, created_at FROM sect_apply WHERE user_id = ?', [userId])
  return row ?? null
}

export async function countMembers(sectRow: number): Promise<number> {
  const row = await get<{ n: number }>('SELECT COUNT(*) AS n FROM sect_members WHERE sect_row = ?', [sectRow])
  const n = row === undefined ? 0 : Number(row.n)
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0
}

export async function countApplies(sectRow: number): Promise<number> {
  const row = await get<{ n: number }>('SELECT COUNT(*) AS n FROM sect_apply WHERE sect_row = ?', [sectRow])
  const n = row === undefined ? 0 : Number(row.n)
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0
}

/**
 * 门人一览:掌门在最前,其余按入门先后。
 *
 * 山门不封顶,门人也就可能上百 —— **一页只取一截**,按道号查时在库里过滤,
 * 不把整本名册读进内存再切(客户端翻页只看得到一页,却要为整册付流量)。
 */
export async function listMembers(
  sectRow: number,
  opts: { q?: string; offset?: number; limit?: number } = {}
): Promise<{ items: SectMemberView[]; total: number }> {
  // LIKE 的通配符与转义符从玩家输入里剔掉:搜「%」不该等于「全部」
  const q = (opts.q ?? '').replace(/[%_\\]/g, '').trim().slice(0, 20)
  const limit = Math.min(50, Math.max(1, Math.trunc(opts.limit ?? 12)))
  const offset = Math.max(0, Math.trunc(opts.offset ?? 0))
  const inner = `SELECT m.user_id, m.role, m.personal, m.total_donated, m.joined_at,
                        COALESCE(p.name, u.username) AS name
                   FROM sect_members m
                   LEFT JOIN profiles p ON p.user_id = m.user_id
                   LEFT JOIN users u ON u.id = m.user_id
                  WHERE m.sect_row = ?`
  const rows = await all<{
    user_id: number
    role: string
    personal: number
    total_donated: number
    joined_at: number
    name: string | null
  }>(
    `SELECT * FROM (${inner}) t
      WHERE (? = '' OR t.name LIKE ?)
      ORDER BY CASE t.role WHEN 'leader' THEN 0 WHEN 'deputy' THEN 1 WHEN 'elder' THEN 2 ELSE 3 END, t.joined_at ASC
      LIMIT ? OFFSET ?`,
    [sectRow, q, `%${q}%`, limit, offset]
  )
  const counted = await get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM (${inner}) t WHERE (? = '' OR t.name LIKE ?)`,
    [sectRow, q, `%${q}%`]
  )
  const total = counted === undefined ? 0 : Math.max(0, Math.trunc(Number(counted.n)))
  return {
    total,
    items: rows.map(r => ({
      userId: Number(r.user_id),
      name: typeof r.name === 'string' && r.name !== '' ? r.name : `道友${Number(r.user_id)}`,
      role: isSectRole(r.role) ? r.role : 'member',
      personal: Number.isFinite(r.personal) ? Math.max(0, Math.trunc(r.personal)) : 0,
      totalDonated: Number.isFinite(r.total_donated) ? Math.max(0, Math.trunc(r.total_donated)) : 0,
      joinedAt: Number.isFinite(r.joined_at) ? Math.trunc(r.joined_at) : 0
    }))
  }
}

/** 待审申请:先到先审 */
export async function listApplies(sectRow: number): Promise<SectApplyView[]> {
  const rows = await all<{
    user_id: number
    created_at: number
    name: string | null
    realm_label: string | null
    realm_index: number | null
  }>(
    `SELECT a.user_id, a.created_at,
            COALESCE(p.name, u.username) AS name,
            p.realm_label, p.realm_index
       FROM sect_apply a
       LEFT JOIN profiles p ON p.user_id = a.user_id
       LEFT JOIN users u ON u.id = a.user_id
      WHERE a.sect_row = ?
      ORDER BY a.created_at ASC`,
    [sectRow]
  )
  return rows.map(r => ({
    userId: Number(r.user_id),
    name: typeof r.name === 'string' && r.name !== '' ? r.name : `道友${Number(r.user_id)}`,
    realmLabel: typeof r.realm_label === 'string' ? r.realm_label : '',
    realmIndex: Number.isFinite(r.realm_index) ? Math.trunc(Number(r.realm_index)) : 0,
    at: Number.isFinite(r.created_at) ? Math.trunc(r.created_at) : 0
  }))
}

/** 可供投师的门派:门人多的在前,最多五十家(客户端一屏够用) */
export async function listSects(): Promise<SectBriefView[]> {
  const rows = await all<{
    id: number
    name: string
    data: string
    leader_name: string | null
    members: number
  }>(
    `SELECT s.id, s.name, s.data,
            (SELECT COALESCE(p.name, u.username) FROM users u LEFT JOIN profiles p ON p.user_id = u.id
              WHERE u.id = s.leader_uid) AS leader_name,
            (SELECT COUNT(*) FROM sect_members m WHERE m.sect_row = s.id) AS members
       FROM sects s
      ORDER BY (SELECT COUNT(*) FROM sect_members m2 WHERE m2.sect_row = s.id) DESC, s.id ASC
      LIMIT 50`
  )
  return rows.map(r => {
    const hall = hallOfData(r.data)
    return {
      id: Number(r.id),
      name: r.name,
      leader: typeof r.leader_name === 'string' && r.leader_name !== '' ? r.leader_name : '',
      members: Number.isFinite(r.members) ? Math.trunc(Number(r.members)) : 0,
      // 与 core/sectRules 的 memberCap 同式:10 + 山门等级(山门不封顶)
      cap: 10 + hall,
      hall
    }
  })
}

/** 从门派 data 里读山门等级(坏 data 按 0;山门无上限,只夹到硬上界) */
export function hallOfData(data: string): number {
  try {
    const parsed = JSON.parse(data) as unknown
    if (typeof parsed !== 'object' || parsed === null) return 0
    const buildings = (parsed as { buildings?: unknown }).buildings
    if (typeof buildings !== 'object' || buildings === null) return 0
    const hall = (buildings as { hall?: unknown }).hall
    return typeof hall === 'number' && Number.isFinite(hall) ? Math.min(999, Math.max(0, Math.trunc(hall))) : 0
  } catch {
    return 0
  }
}


/* ---------------- 个人技能(1.74.1 运营定则) ---------------- */

/**
 * 门人的技能修为住 `sect_member_skills`(一人一行,**跨门派保留** —— 换门带入)。
 * 旧档迁移:成员还没有个人行时,按门派 data.skills 里那份「共有等级」播种一次,
 * 播完即把共有等级清空(消费掉,后来入门的人从零修起)。
 */
async function readMemberSkills(userId: number, legacy: Record<string, number>): Promise<{ skills: Record<string, number>; seeded: boolean }> {
  const row = await get<{ skills: string }>('SELECT skills FROM sect_member_skills WHERE user_id = ?', [userId])
  if (row !== undefined) {
    try {
      const parsed = JSON.parse(row.skills) as unknown
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return { skills: parsed as Record<string, number>, seeded: false }
      }
    } catch {
      /* 行坏了按无修为走,等下一次修习重写 */
    }
    return { skills: {}, seeded: false }
  }
  // 播种:旧共有等级全数转成个人等级;公账里的共有等级由调用方清掉(消费掉,后来者从零修起)
  const skills: Record<string, number> = {}
  for (const [id, lv] of Object.entries(legacy)) {
    const n = Math.trunc(Number(lv))
    if (Number.isFinite(n) && n > 0) skills[id] = Math.min(30, n)
  }
  await run('REPLACE INTO sect_member_skills (user_id, skills, updated_at) VALUES (?, ?, ?)', [
    userId,
    JSON.stringify(skills),
    Date.now()
  ])
  return { skills, seeded: true }
}

export async function writeMemberSkills(userId: number, skills: Record<string, number>): Promise<void> {
  await run('REPLACE INTO sect_member_skills (user_id, skills, updated_at) VALUES (?, ?, ?)', [
    userId,
    JSON.stringify(skills),
    Date.now()
  ])
}

/* ---------------- 组合与写入 ---------------- */

/** 门派公账 + 我的私账 = 客户端看到的形状 */
export function composeState(body: SectState, member: SectMemberRow, members: number): SectState {
  return {
    ...body,
    personal: Math.max(0, Math.trunc(member.personal)),
    day: member.day,
    donationsToday: Math.max(0, Math.trunc(member.donations_today)),
    totalDonated: Math.max(0, Math.trunc(member.total_donated)),
    role: isSectRole(member.role) ? member.role : 'member',
    memberCount: Math.max(0, members)
  }
}

/**
 * 读出并**结算到点工程**:服务端时钟过了 finishAt 就把等级落下去。
 * 返回 done 供调用方播报;需要落库时由调用方 writeBody(读时不写,免并发读互相覆盖)。
 */
export async function readSettledSectState(
  userId: number,
  now = Date.now()
): Promise<{ state: SectState; done: string[]; exists: boolean; member: SectMemberRow | null; sectRow: number }> {
  const member = await readMember(userId)
  if (member === null) return { state: await emptyState(), done: [], exists: false, member: null, sectRow: 0 }
  const body = await readBody(member.sect_row)
  if (body === null) {
    // 门派行没了(手工删库):关系一并清掉,别让玩家挂着一家不存在的门派
    await removeMember(userId)
    return { state: await emptyState(), done: [], exists: false, member: null, sectRow: 0 }
  }
  const mod = await rules()
  let state: SectState
  try {
    state = mod.normalizeSectState(JSON.parse(body.data) as unknown, now)
  } catch {
    state = await emptyState()
  }
  const settled = mod.settleBuild(state, now)
  if (settled.done.length > 0) await writeBody(body.id, settled.state)
  // 技能归个人(1.74.1):state.skills 覆盖成我自己的等级;旧共有等级播种进个人行后清掉
  const mine = await readMemberSkills(userId, settled.state.skills)
  if (mine.seeded) await writeBody(body.id, { ...settled.state, skills: {} })
  settled.state.skills = mine.skills
  const members = await countMembers(body.id)
  return {
    state: composeState(settled.state, member, members),
    done: settled.done,
    exists: true,
    member,
    sectRow: body.id
  }
}

/** 读门派(已修形,未结算) —— 存档复算与掉落环境用它把门派加成算进去 */
export async function readSectState(userId: number, now = Date.now()): Promise<SectState> {
  const { state } = await readSettledSectState(userId, now)
  return state
}

/** 写门派公账(调用方须持该门派的锁);只落公账那几项,个人的账不往这张表里写 */
export async function writeBody(sectRow: number, state: SectState): Promise<void> {
  const data = JSON.stringify({
    name: state.name,
    pool: state.pool,
    skills: state.skills,
    buildings: state.buildings,
    build: state.build
  })
  await run('UPDATE sects SET data = ? WHERE id = ?', [data, sectRow])
}

/** 建门派,返回新行号 */
export async function createSect(input: {
  name: string
  leaderUid: number
  state: SectState
  now?: number
}): Promise<number> {
  const now = input.now ?? Date.now()
  const data = JSON.stringify({
    name: input.name,
    pool: input.state.pool,
    skills: input.state.skills,
    buildings: input.state.buildings,
    build: input.state.build
  })
  const res = await run('INSERT INTO sects (name, leader_uid, data, created_at) VALUES (?, ?, ?, ?)', [
    input.name,
    input.leaderUid,
    data,
    now
  ])
  return Number(res.insertId)
}

/** 加一个门人(REPLACE 语义:重复调用只是覆盖,不会出现两笔) */
export async function addMember(
  userId: number,
  sectRow: number,
  role: SectRole,
  now = Date.now()
): Promise<void> {
  await upsertByPk('sect_members', {
    user_id: userId,
    sect_row: sectRow,
    role,
    personal: 0,
    day: '',
    donations_today: 0,
    total_donated: 0,
    joined_at: now
  })
}

export async function removeMember(userId: number): Promise<void> {
  await run('DELETE FROM sect_members WHERE user_id = ?', [userId])
}

/** 某门里挂着某职位的有几人(任职前按名额表挡;不算 target 本人,由调用方剔除) */
export async function countByRole(sectRow: number, role: SectRole, excludeUser = 0): Promise<number> {
  const row = await get<{ n: number }>(
    'SELECT COUNT(*) AS n FROM sect_members WHERE sect_row = ? AND role = ? AND user_id <> ?',
    [sectRow, role, excludeUser]
  )
  return row === undefined ? 0 : Math.max(0, Math.trunc(Number(row.n)))
}

/** 改某个门人的私账(不存在即什么也不做) */
export async function patchMember(
  userId: number,
  patch: { personal?: number; day?: string; donationsToday?: number; totalDonated?: number; role?: SectRole }
): Promise<void> {
  const sets: string[] = []
  const params: unknown[] = []
  if (patch.personal !== undefined) {
    sets.push('personal = ?')
    params.push(Math.max(0, Math.trunc(patch.personal)))
  }
  if (patch.day !== undefined) {
    sets.push('day = ?')
    params.push(patch.day)
  }
  if (patch.donationsToday !== undefined) {
    sets.push('donations_today = ?')
    params.push(Math.max(0, Math.trunc(patch.donationsToday)))
  }
  if (patch.totalDonated !== undefined) {
    sets.push('total_donated = ?')
    params.push(Math.max(0, Math.trunc(patch.totalDonated)))
  }
  if (patch.role !== undefined) {
    sets.push('role = ?')
    params.push(patch.role)
  }
  if (sets.length === 0) return
  params.push(userId)
  await run(`UPDATE sect_members SET ${sets.join(', ')} WHERE user_id = ?`, params)
}

export async function setLeader(sectRow: number, userId: number): Promise<void> {
  await run('UPDATE sects SET leader_uid = ? WHERE id = ?', [userId, sectRow])
  await run("UPDATE sect_members SET role = 'member' WHERE sect_row = ? AND role = 'leader'", [sectRow])
  await run("UPDATE sect_members SET role = 'leader' WHERE user_id = ? AND sect_row = ?", [userId, sectRow])
}

export async function deleteSect(sectRow: number): Promise<void> {
  await run('DELETE FROM sect_apply WHERE sect_row = ?', [sectRow])
  await run('DELETE FROM sect_members WHERE sect_row = ?', [sectRow])
  await run('DELETE FROM sects WHERE id = ?', [sectRow])
}

export async function addApply(userId: number, sectRow: number, now = Date.now()): Promise<void> {
  await upsertByPk('sect_apply', { user_id: userId, sect_row: sectRow, created_at: now })
}

export async function removeApply(userId: number): Promise<void> {
  await run('DELETE FROM sect_apply WHERE user_id = ?', [userId])
}

/** 门派名是否已被占(建派前查一次;真正的唯一性由 sects.name 的 UNIQUE 兜住) */
export async function nameTaken(name: string): Promise<boolean> {
  const row = await get<{ n: number }>('SELECT COUNT(*) AS n FROM sects WHERE name = ?', [name])
  return row !== undefined && Number(row.n) > 0
}

/**
 * 清门派(删档时用)。
 * 掌门删档:门中还有别人 → 掌门之位转给最先入门的那位(门派不该因一人重开而散);
 * 只剩自己 → 整个门派连门人带申请一起删。
 * 门人删档:只删自己那笔关系(个人贡献随之清零)。
 */
export async function clearSect(userId: number): Promise<void> {
  const member = await readMember(userId)
  if (member !== null) {
    if (member.role === 'leader') {
      const heir = await get<{ user_id: number }>(
        "SELECT user_id FROM sect_members WHERE sect_row = ? AND user_id <> ? ORDER BY joined_at ASC LIMIT 1",
        [member.sect_row, userId]
      )
      if (heir !== undefined) await setLeader(member.sect_row, Number(heir.user_id))
      else await deleteSect(member.sect_row)
    }
    await removeMember(userId)
  }
  await removeApply(userId)
  await run('DELETE FROM sect_spend WHERE user_id = ?', [userId])
}

/* ---------------- 旧档迁移(1.68.0 的 sect_state → sects + sect_members) ---------------- */

/**
 * 一次性迁移:把「一人一派」时代的行搬成新的门派 + 掌门。
 * 在服务启动时跑(见 index.ts),搬完删旧行 —— 两处同时活着就是两个事实源。
 * 门派名撞车时补一个「·二」之类的后缀(名字是给玩家看的,不值得为它丢一整份门派)。
 */
export async function migrateLegacySects(): Promise<number> {
  const rows = await all<{ user_id: number; data: string }>('SELECT user_id, data FROM sect_state')
  if (rows.length === 0) return 0
  const mod = await rules()
  let moved = 0
  for (const row of rows) {
    const uid = Number(row.user_id)
    try {
      const existing = await readMember(uid)
      if (existing !== null) {
        // 已经有门派关系(迁移过或新功能建的):旧行直接作废
        await run('DELETE FROM sect_state WHERE user_id = ?', [uid])
        continue
      }
      const state = mod.normalizeSectState(JSON.parse(row.data) as unknown, Date.now())
      if (state.name === '') {
        // 没立过派的空行:没有可搬的东西,直接销掉(否则每次启动都要再看一遍)
        await run('DELETE FROM sect_state WHERE user_id = ?', [uid])
        continue
      }
      let name = state.name
      let n = 2
      while (await nameTaken(name)) {
        const suffix = `·${n === 2 ? '二' : n === 3 ? '三' : String(n)}`
        name = `${state.name.slice(0, Math.max(2, 7 - suffix.length))}${suffix}`
        n += 1
        if (n > 9) break
      }
      if (await nameTaken(name)) continue
      const sectRow = await createSect({ name, leaderUid: uid, state })
      await addMember(uid, sectRow, 'leader', Date.now())
      // 个人账搬过去:一个人都不该因为改版丢掉捐献记录
      await patchMember(uid, {
        personal: state.personal,
        day: state.day,
        donationsToday: state.donationsToday,
        totalDonated: state.totalDonated
      })
      await run('DELETE FROM sect_state WHERE user_id = ?', [uid])
      moved += 1
    } catch {
      // 单行搬不动就留着,下次启动再试;绝不因为一行坏数据挡住启动
    }
  }
  return moved
}

/* ---------------- 捐献/建派支出账 ---------------- */

export interface SectSpend {
  stone: { m: number; e: number }
  ore: number
  wudao: number
  /** 灵草品阶(-1 = 本次没有灵草);一次捐献只涉及一个品阶 */
  herbGrade: number
  herb: number
}

export const NO_SECT_SPEND: SectSpend = {
  stone: { m: 0, e: 0 },
  ore: 0,
  wudao: 0,
  herbGrade: -1,
  herb: 0
}

/** 记一笔支出(成本取服务端复算值,不信客户端报的数) */
export async function recordSectSpend(userId: number, cost: SectSpend): Promise<void> {
  const m = Number.isFinite(cost.stone.m) && cost.stone.m > 0 ? cost.stone.m : 0
  const e = Number.isFinite(cost.stone.e) && cost.stone.e > 0 ? Math.trunc(cost.stone.e) : 0
  const ore = Number.isFinite(cost.ore) && cost.ore > 0 ? Math.trunc(cost.ore) : 0
  const wudao = Number.isFinite(cost.wudao) && cost.wudao > 0 ? Math.trunc(cost.wudao) : 0
  const herbGrade = Number.isFinite(cost.herbGrade) ? Math.trunc(cost.herbGrade) : -1
  const herb = Number.isFinite(cost.herb) && cost.herb > 0 ? Math.trunc(cost.herb) : 0
  if (m === 0 && e === 0 && ore === 0 && wudao === 0 && herb === 0) return
  await run(
    `INSERT INTO sect_spend (user_id, cost_stone_m, cost_stone_e, cost_ore, cost_wudao, herb_grade, cost_herb, settled, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    [userId, m, e, ore, wudao, herb > 0 ? herbGrade : -1, herb, Date.now()]
  )
}

export interface PendingSectSpend {
  stone: { m: number; e: number }
  ore: number
  wudao: number
  /** 品阶 → 尚未兑现的灵草株数 */
  herbByGrade: Record<string, number>
}

/** 尚未在存档里体现的支出合计(上传时并入 pendingSpend) */
export async function pendingSectSpend(userId: number): Promise<PendingSectSpend> {
  const rows = await all<{
    cost_stone_m: number
    cost_stone_e: number
    cost_ore: number
    cost_wudao: number
    herb_grade: number
    cost_herb: number
  }>(
    'SELECT cost_stone_m, cost_stone_e, cost_ore, cost_wudao, herb_grade, cost_herb FROM sect_spend WHERE user_id = ? AND settled = 0',
    [userId]
  )
  let m = 0
  let e = 0
  let ore = 0
  let wudao = 0
  const herbByGrade: Record<string, number> = {}
  for (const r of rows) {
    m += Number.isFinite(r.cost_stone_m) ? r.cost_stone_m : 0
    e += Number.isFinite(r.cost_stone_e) ? Math.trunc(r.cost_stone_e) : 0
    ore += Number.isFinite(r.cost_ore) ? Math.trunc(r.cost_ore) : 0
    wudao += Number.isFinite(r.cost_wudao) ? Math.trunc(r.cost_wudao) : 0
    const herb = Number.isFinite(r.cost_herb) ? Math.trunc(r.cost_herb) : 0
    if (herb > 0) {
      const key = String(Number.isFinite(r.herb_grade) && r.herb_grade >= 0 ? Math.trunc(r.herb_grade) : 1)
      herbByGrade[key] = (herbByGrade[key] ?? 0) + herb
    }
    // 与 gnum 的归一化同向:尾数超 1e6 就进一位
    while (m >= 1e6) {
      m /= 1000
      e += 3
    }
  }
  return { stone: { m, e }, ore: Math.trunc(ore), wudao: Math.trunc(wudao), herbByGrade }
}

/** 存档已落库:这批支出算兑现了(兑现即删行,与 marketLedger 同规) */
export async function settleSectSpend(userId: number): Promise<void> {
  await run('DELETE FROM sect_spend WHERE user_id = ? AND settled = 0', [userId])
}
