/** 副本公共件:每日限次(dungeon_daily,UTC+8 日键)+ 房间码(输入同码自动进房) */
import { randomInt } from 'node:crypto'
import { all, driverName, get, run } from './db.js'
import { getConfigNumber } from './config.js'
import { notifyUser } from './ws.js'

const IS_MYSQL = driverName() === 'mysql'

/** 当日键(UTC+8);dungeon_daily 按它限次 */
export function dayKey(now = Date.now()): string {
  return new Date(now + 8 * 3600_000).toISOString().slice(0, 10)
}

export async function attemptsUsed(userId: number, dungeon: string, day: string): Promise<number> {
  const row = await get<{ count: number }>(
    'SELECT count FROM dungeon_daily WHERE user_id = ? AND dungeon = ? AND day = ?',
    [userId, dungeon, day]
  )
  return row?.count ?? 0
}

/** 计数 upsert:双方言(仅加计数,REPLACE 语义不适用) */
export async function bumpDaily(userId: number, dungeon: string, day: string): Promise<void> {
  if (IS_MYSQL) {
    await run(
      `INSERT INTO dungeon_daily (user_id, dungeon, day, count) VALUES (?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE count = count + 1`,
      [userId, dungeon, day]
    )
    return
  }
  await run(
    `INSERT INTO dungeon_daily (user_id, dungeon, day, count) VALUES (?, ?, ?, 1)
     ON CONFLICT(user_id, dungeon, day) DO UPDATE SET count = count + 1`,
    [userId, dungeon, day]
  )
}

/** 副本每日次数上限:<dungeon>_daily_attempts(默认 1),GM 后台可改 */
export async function attemptsLimit(dungeon: string): Promise<number> {
  return getConfigNumber(`${dungeon}_daily_attempts`, 1)
}

/* ---------------- 房间码 ---------------- */

export const DUNGEONS = ['demon', 'explore', 'guard', 'array'] as const
export type DungeonKey = (typeof DUNGEONS)[number]

export const DUNGEON_NAMES: Record<DungeonKey, string> = {
  demon: '心魔镜像',
  explore: '秘境共探',
  guard: '洞天守卫',
  array: '共修大阵'
}

export function isDungeonKey(v: unknown): v is DungeonKey {
  return typeof v === 'string' && (DUNGEONS as readonly string[]).includes(v)
}

export const ROOM_MAX_SIZE = 5
const ROOM_TTL_MS = 2 * 3600_000

export interface RoomRow {
  code: string
  dungeon: string
  leader_id: number
  status: string
  created_at: number
}

export interface RoomMemberRow {
  code: string
  user_id: number
  name: string
  joined_at: number
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function newCode(): string {
  let c = ''
  for (let i = 0; i < 6; i++) c += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)]
  return c
}

/** 清理过期/完赛的房间(懒清扫,随建房/查询触发) */
async function sweepRooms(): Promise<void> {
  const dead = await all<RoomRow>(
    "SELECT code FROM dungeon_teams WHERE status != 'open' OR created_at < ?",
    [Date.now() - ROOM_TTL_MS]
  )
  for (const t of dead) await deleteRoom(t.code)
}

async function deleteRoom(code: string): Promise<void> {
  await run('DELETE FROM dungeon_team_members WHERE code = ?', [code])
  await run('DELETE FROM dungeon_teams WHERE code = ?', [code])
}

/** 我在某个未完赛房间里的行(有则先退,保证「输入同码即进房」零摩擦) */
export async function currentRoomOf(userId: number): Promise<RoomRow | null> {
  await sweepRooms()
  const row = await get<RoomRow>(
    `SELECT t.code, t.dungeon, t.leader_id, t.status, t.created_at
     FROM dungeon_teams t JOIN dungeon_team_members m ON m.code = t.code
     WHERE m.user_id = ? AND t.status = 'open' AND t.created_at >= ?
     ORDER BY m.joined_at DESC LIMIT 1`,
    [userId, Date.now() - ROOM_TTL_MS]
  )
  return row ?? null
}

export interface RoomSnapshot {
  code: string
  dungeon: DungeonKey
  leaderId: number
  members: Array<{ userId: number; name: string }>
}

export async function roomSnapshot(room: RoomRow): Promise<RoomSnapshot> {
  const rows = await all<RoomMemberRow>('SELECT * FROM dungeon_team_members WHERE code = ? ORDER BY joined_at', [room.code])
  return {
    code: room.code,
    dungeon: room.dungeon as DungeonKey,
    leaderId: room.leader_id,
    members: rows.map(r => ({ userId: r.user_id, name: r.name }))
  }
}

export interface RoomJoinResult {
  room: RoomSnapshot
  /** 被自动退出并通知的旧房间码(空串 = 无) */
  leftCode: string
  /** 此人入房后是否满员(满员提醒可开拔) */
  full: boolean
}

/** 建房:先退掉旧房间;码冲突自动换码重试 */
export async function createRoom(userId: number, name: string, dungeon: DungeonKey): Promise<RoomJoinResult> {
  await leaveRoom(userId, false)
  for (let i = 0; i < 8; i++) {
    const code = newCode()
    const taken = await get<{ code: string }>('SELECT code FROM dungeon_teams WHERE code = ?', [code])
    if (taken !== undefined) continue
    await run('INSERT INTO dungeon_teams (code, dungeon, leader_id, status, created_at) VALUES (?, ?, ?, ?, ?)', [
      code,
      dungeon,
      userId,
      'open',
      Date.now()
    ])
    await run('INSERT INTO dungeon_team_members (code, user_id, name, joined_at) VALUES (?, ?, ?, ?)', [
      code,
      userId,
      name,
      Date.now()
    ])
    const row = await get<RoomRow>('SELECT * FROM dungeon_teams WHERE code = ?', [code])
    return { room: await roomSnapshot(row!), leftCode: '', full: false }
  }
  throw new Error('房间码生成失败,请重试')
}

/** 用房间码进房:同码即入;已在别的房间自动退出并原路通知 */
export async function joinRoom(userId: number, name: string, code: string): Promise<RoomJoinResult> {
  const want = code.trim().toUpperCase()
  await sweepRooms()
  const room = await get<RoomRow>("SELECT * FROM dungeon_teams WHERE code = ? AND status = 'open'", [want])
  if (room === undefined) throw new Error('房间码无效或已开拔')
  if (room.created_at < Date.now() - ROOM_TTL_MS) throw new Error('房间已过期,请让房主重建')
  const members = await all<RoomMemberRow>('SELECT * FROM dungeon_team_members WHERE code = ?', [want])
  if (members.some(m => m.user_id === userId)) {
    return { room: await roomSnapshot(room), leftCode: '', full: members.length >= ROOM_MAX_SIZE }
  }
  if (members.length >= ROOM_MAX_SIZE) throw new Error('房间已满(5 人)')

  // 自动退出旧房间(仅未开拔的),旧房间长收到离房通知
  let leftCode = ''
  const prev = await currentRoomOf(userId)
  if (prev !== null) {
    leftCode = prev.code
    await leaveRoom(userId, false)
  }

  await run('INSERT INTO dungeon_team_members (code, user_id, name, joined_at) VALUES (?, ?, ?, ?)', [
    want,
    userId,
    name,
    Date.now()
  ])
  // 房内广播:有人凭码入房
  for (const m of members) {
    notifyUser(m.user_id, { type: 'room_join', code: want, name, dungeon: room.dungeon, at: Date.now() })
  }
  const after = await all<RoomMemberRow>('SELECT * FROM dungeon_team_members WHERE code = ?', [want])
  return { room: await roomSnapshot(room), leftCode, full: after.length >= ROOM_MAX_SIZE }
}

/** 退出房间;silent=true 时不通知道友(开拔结算等内部场景) */
export async function leaveRoom(userId: number, notify = true): Promise<void> {
  const room = await currentRoomOf(userId)
  if (room === null) return
  const members = await all<RoomMemberRow>('SELECT * FROM dungeon_team_members WHERE code = ?', [room.code])
  const me = members.find(m => m.user_id === userId)
  await run('DELETE FROM dungeon_team_members WHERE code = ? AND user_id = ?', [room.code, userId])
  const rest = members.filter(m => m.user_id !== userId)
  if (rest.length === 0) {
    await deleteRoom(room.code)
    return
  }
  if (room.leader_id === userId && rest.length > 0) {
    // 房主走了,移交房主
    await run('UPDATE dungeon_teams SET leader_id = ? WHERE code = ?', [rest[0]!.user_id, room.code])
  }
  if (notify) {
    const myName = me?.name ?? '道友'
    for (const m of rest) {
      notifyUser(m.user_id, { type: 'room_leave', code: room.code, name: myName, dungeon: room.dungeon, at: Date.now() })
    }
  }
}

/** 开拔:返回成员快照;code 为空 = 独行 */
export async function resolveRunRoster(userId: number, code: string): Promise<Array<{ userId: number; name: string }>> {
  if (code.trim() === '') return [{ userId, name: '' }] // name 由调用方补
  const want = code.trim().toUpperCase()
  const room = await get<RoomRow>("SELECT * FROM dungeon_teams WHERE code = ? AND status = 'open'", [want])
  if (room === undefined) throw new Error('房间码无效或已开拔')
  const members = await all<RoomMemberRow>('SELECT * FROM dungeon_team_members WHERE code = ? ORDER BY joined_at', [want])
  if (!members.some(m => m.user_id === userId)) throw new Error('你不在此房间中')
  return members.map(m => ({ userId: m.user_id, name: m.name }))
}

/** 开拔后标记完赛并解散(记录已随 ws/响应分发) */
export async function disbandRoom(code: string): Promise<void> {
  if (code.trim() === '') return
  await deleteRoom(code.trim().toUpperCase())
}
