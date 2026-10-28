/** 好友 / 排行榜 / 聊天历史 / 切磋 */
import express, { type Request, type Response } from 'express'
import { db, findUserByName, findUserById, getProfile } from '../db.js'
import { requireAuth } from '../auth.js'
import { simulateDuel } from '../pvp.js'

export const socialRouter = express.Router()

interface FriendRow {
  id: number
  user_id: number
  friend_id: number
  status: string
}

interface UserRow {
  id: number
  username: string
}

export function publicProfile(uid: number): { id: number; name: string; realmLabel: string; realmIndex: number; powerM: number; powerE: number } | null {
  const p = getProfile.get(uid)
  if (p === undefined) return null
  return { id: uid, name: p.name, realmLabel: p.realm_label, realmIndex: p.realm_index, powerM: p.power_m, powerE: p.power_e }
}

socialRouter.get('/friends', requireAuth, (req: Request, res: Response) => {
  const uid = req.user!.id
  const rows = db
    .prepare(
      `SELECT f.id, f.user_id, f.friend_id, f.status,
              u.id AS other_id, u.username AS other_name
       FROM friends f JOIN users u ON u.id = CASE WHEN f.user_id = @uid THEN f.friend_id ELSE f.user_id END
       WHERE (f.user_id = @uid OR f.friend_id = @uid) AND f.status = 'pending'
       UNION ALL
       SELECT f.id, f.user_id, f.friend_id, f.status,
              u.id, u.username
       FROM friends f JOIN users u ON u.id = f.friend_id
       WHERE f.user_id = @uid AND f.status = 'accepted'`
    )
    .all({ uid }) as Array<FriendRow & { other_id: number; other_name: string }>
  const incoming: Array<{ requestId: number; user: { id: number; name: string } }> = []
  const outgoing: Array<{ requestId: number; user: { id: number; name: string } }> = []
  const accepted: Array<{ id: number; name: string; online: boolean; profile: ReturnType<typeof publicProfile> }> = []
  for (const r of rows) {
    if (r.status === 'pending') {
      const entry = { requestId: r.id, user: { id: r.other_id, name: r.other_name } }
      if (r.friend_id === uid) incoming.push(entry)
      else outgoing.push(entry)
    } else {
      accepted.push({
        id: r.other_id,
        name: publicProfile(r.other_id)?.name ?? r.other_name,
        online: isOnline(r.other_id),
        profile: publicProfile(r.other_id)
      })
    }
  }
  res.json({ incoming, outgoing, accepted })
})

socialRouter.post('/friends/request', requireAuth, (req: Request, res: Response) => {
  const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>
  const username = typeof body.username === 'string' ? body.username.trim() : ''
  const target = findUserByName.get(username.toLowerCase()) as UserRow | undefined
  if (target === undefined) {
    res.status(404).json({ error: '查无此道友' })
    return
  }
  if (target.id === req.user!.id) {
    res.status(400).json({ error: '不能加自己' })
    return
  }
  const existing = db
    .prepare('SELECT * FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)')
    .get(req.user!.id, target.id, target.id, req.user!.id) as FriendRow | undefined
  if (existing !== undefined) {
    if (existing.status === 'accepted') {
      res.status(400).json({ error: '已是道友' })
    } else if (existing.friend_id === req.user!.id) {
      // 对方先发来的请求:直接接受
      db.prepare("UPDATE friends SET status = 'accepted' WHERE id = ?").run(existing.id)
      notifyFriendAccepted(target.id, { id: req.user!.id, name: req.user!.username })
      res.json({ ok: true, accepted: true })
    } else {
      res.status(400).json({ error: '已发出请求' })
    }
    return
  }
  db.prepare("INSERT INTO friends (user_id, friend_id, status, created_at) VALUES (?, ?, 'pending', ?)").run(
    req.user!.id,
    target.id,
    Date.now()
  )
  notifyFriendRequest(target.id, { id: req.user!.id, name: req.user!.username })
  res.json({ ok: true })
})

socialRouter.post('/friends/respond', requireAuth, (req: Request, res: Response) => {
  const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>
  const requestId = typeof body.requestId === 'number' && Number.isFinite(body.requestId) ? Math.trunc(body.requestId) : 0
  const accept = body.accept === true
  const row = db
    .prepare("SELECT * FROM friends WHERE id = ? AND friend_id = ? AND status = 'pending'")
    .get(requestId, req.user!.id) as FriendRow | undefined
  if (row === undefined) {
    res.status(404).json({ error: '无此请求' })
    return
  }
  if (accept) {
    db.prepare("UPDATE friends SET status = 'accepted' WHERE id = ?").run(row.id)
    const requester = findUserById.get(row.user_id) as UserRow | undefined
    if (requester !== undefined) notifyFriendAccepted(requester.id, { id: req.user!.id, name: req.user!.username })
  } else {
    db.prepare('DELETE FROM friends WHERE id = ?').run(row.id)
  }
  res.json({ ok: true })
})

socialRouter.delete('/friends/:friendId', requireAuth, (req: Request, res: Response) => {
  const friendId = Number(req.params.friendId)
  if (!Number.isFinite(friendId)) {
    res.status(400).json({ error: '参数无效' })
    return
  }
  db.prepare('DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)').run(
    req.user!.id,
    friendId,
    friendId,
    req.user!.id
  )
  res.json({ ok: true })
})

socialRouter.get('/leaderboard', requireAuth, (_req: Request, res: Response) => {
  const rows = db
    .prepare('SELECT user_id, name, realm_label, realm_index, power_m, power_e FROM profiles ORDER BY realm_index DESC, power_e DESC, power_m DESC LIMIT 50')
    .all() as Array<{ user_id: number; name: string; realm_label: string; realm_index: number; power_m: number; power_e: number }>
  res.json({
    board: rows.map((r, i) => ({
      rank: i + 1,
      id: r.user_id,
      name: r.name,
      realmLabel: r.realm_label,
      realmIndex: r.realm_index,
      powerM: r.power_m,
      powerE: r.power_e
    }))
  })
})

socialRouter.get('/chat/history', requireAuth, (_req: Request, res: Response) => {
  const rows = db
    .prepare('SELECT id, user_id, name, content, created_at FROM chat_messages ORDER BY id DESC LIMIT 50')
    .all() as Array<{ id: number; user_id: number; name: string; content: string; created_at: number }>
  rows.reverse()
  res.json({ messages: rows })
})

socialRouter.post('/pvp', requireAuth, (req: Request, res: Response) => {
  const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>
  const targetId = typeof body.targetId === 'number' && Number.isFinite(body.targetId) ? Math.trunc(body.targetId) : 0
  if (targetId === req.user!.id) {
    res.status(400).json({ error: '不能与自己对练' })
    return
  }
  const mine = getProfile.get(req.user!.id)
  const theirs = getProfile.get(targetId)
  if (mine === undefined) {
    res.status(400).json({ error: '自身档案未同步' })
    return
  }
  if (theirs === undefined) {
    res.status(404).json({ error: '对方档案未同步' })
    return
  }
  res.json(
    simulateDuel(
      { id: req.user!.id, name: mine.name, hpM: mine.hp_m, hpE: mine.hp_e, atkM: mine.atk_m, atkE: mine.atk_e, powerM: mine.power_m, powerE: mine.power_e },
      { id: targetId, name: theirs.name, hpM: theirs.hp_m, hpE: theirs.hp_e, atkM: theirs.atk_m, atkE: theirs.atk_e, powerM: theirs.power_m, powerE: theirs.power_e }
    )
  )
})

// ---- 在线状态由 ws 网关注册进来(避免循环依赖,用注入) ----

type IsOnline = (uid: number) => boolean
type Notify = (uid: number, msg: Record<string, unknown>) => void

let isOnlineFn: IsOnline = () => false
let notifyFn: Notify = () => undefined

export function registerPresence(fns: { isOnline: IsOnline; notify: Notify }): void {
  isOnlineFn = fns.isOnline
  notifyFn = fns.notify
}

function isOnline(uid: number): boolean {
  return isOnlineFn(uid)
}

function notifyFriendRequest(uid: number, from: { id: number; name: string }): void {
  notifyFn(uid, { type: 'friendRequest', from })
}

function notifyFriendAccepted(uid: number, by: { id: number; name: string }): void {
  notifyFn(uid, { type: 'friendAccepted', by })
}
