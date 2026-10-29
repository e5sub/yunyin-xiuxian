/** 好友 / 排行榜 / 聊天历史 / 切磋 / 游戏参数下发 */
import express, { type Request, type Response } from 'express'
import { all, get, run } from '../db.js'
import { getConfigNumber } from '../config.js'
import { requireAuth } from '../auth.js'
import { simulateDuel } from '../pvp.js'
import { broadcastAll, onlineCount, onlineList, touchPresence } from '../ws.js'

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

export interface ProfileRow {
  user_id: number
  name: string
  realm_label: string
  realm_index: number
  power_m: number
  power_e: number
  hp_m: number
  hp_e: number
  atk_m: number
  atk_e: number
  updated_at: number
}

export async function getProfileRow(uid: number): Promise<ProfileRow | undefined> {
  return get<ProfileRow>('SELECT * FROM profiles WHERE user_id = ?', [uid])
}

export async function publicProfile(
  uid: number
): Promise<{ id: number; name: string; realmLabel: string; realmIndex: number; powerM: number; powerE: number } | null> {
  const p = await getProfileRow(uid)
  if (p === undefined) return null
  return { id: uid, name: p.name, realmLabel: p.realm_label, realmIndex: p.realm_index, powerM: p.power_m, powerE: p.power_e }
}

socialRouter.get('/friends', requireAuth, (req: Request, res: Response) => {
  void (async () => {
    const uid = req.user!.id
    const rows = await all<FriendRow & { other_id: number; other_name: string }>(
      `SELECT f.id, f.user_id, f.friend_id, f.status,
              u.id AS other_id, u.username AS other_name
       FROM friends f JOIN users u ON u.id = CASE WHEN f.user_id = ? THEN f.friend_id ELSE f.user_id END
       WHERE (f.user_id = ? OR f.friend_id = ?) AND f.status = 'pending'
       UNION ALL
       SELECT f.id, f.user_id, f.friend_id, f.status,
              u.id, u.username
       FROM friends f JOIN users u ON u.id = f.friend_id
       WHERE f.user_id = ? AND f.status = 'accepted'`,
      [uid, uid, uid, uid]
    )
    const incoming: Array<{ requestId: number; user: { id: number; name: string } }> = []
    const outgoing: Array<{ requestId: number; user: { id: number; name: string } }> = []
    const accepted: Array<{ id: number; name: string; online: boolean; profile: Awaited<ReturnType<typeof publicProfile>> }> = []
    for (const r of rows) {
      if (r.status === 'pending') {
        const entry = { requestId: r.id, user: { id: r.other_id, name: r.other_name } }
        if (r.friend_id === uid) incoming.push(entry)
        else outgoing.push(entry)
      } else {
        const prof = await publicProfile(r.other_id)
        accepted.push({
          id: r.other_id,
          name: prof?.name ?? r.other_name,
          online: isOnline(r.other_id),
          profile: prof
        })
      }
    }
    res.json({ incoming, outgoing, accepted })
  })().catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
})

socialRouter.post('/friends/request', requireAuth, (req: Request, res: Response) => {
  void (async () => {
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>
    const username = typeof body.username === 'string' ? body.username.trim() : ''
    const target = await get<UserRow>('SELECT id, username FROM users WHERE username_lower = ?', [username.toLowerCase()])
    if (target === undefined) {
      res.status(404).json({ error: '查无此道友' })
      return
    }
    if (target.id === req.user!.id) {
      res.status(400).json({ error: '不能加自己' })
      return
    }
    const existing = await get<FriendRow>(
      'SELECT * FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)',
      [req.user!.id, target.id, target.id, req.user!.id]
    )
    if (existing !== undefined) {
      if (existing.status === 'accepted') {
        res.status(400).json({ error: '已是道友' })
      } else if (existing.friend_id === req.user!.id) {
        // 对方先发来的请求:直接接受
        await run("UPDATE friends SET status = 'accepted' WHERE id = ?", [existing.id])
        notifyFriendAccepted(target.id, { id: req.user!.id, name: req.user!.username })
        res.json({ ok: true, accepted: true })
      } else {
        res.status(400).json({ error: '已发出请求' })
      }
      return
    }
    await run("INSERT INTO friends (user_id, friend_id, status, created_at) VALUES (?, ?, 'pending', ?)", [
      req.user!.id,
      target.id,
      Date.now()
    ])
    notifyFriendRequest(target.id, { id: req.user!.id, name: req.user!.username })
    res.json({ ok: true })
  })().catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
})

socialRouter.post('/friends/respond', requireAuth, (req: Request, res: Response) => {
  void (async () => {
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>
    const requestId = typeof body.requestId === 'number' && Number.isFinite(body.requestId) ? Math.trunc(body.requestId) : 0
    const accept = body.accept === true
    const row = await get<FriendRow>("SELECT * FROM friends WHERE id = ? AND friend_id = ? AND status = 'pending'", [
      requestId,
      req.user!.id
    ])
    if (row === undefined) {
      res.status(404).json({ error: '无此请求' })
      return
    }
    if (accept) {
      await run("UPDATE friends SET status = 'accepted' WHERE id = ?", [row.id])
      const requester = await get<UserRow>('SELECT id, username FROM users WHERE id = ?', [row.user_id])
      if (requester !== undefined) notifyFriendAccepted(requester.id, { id: req.user!.id, name: req.user!.username })
    } else {
      await run('DELETE FROM friends WHERE id = ?', [row.id])
    }
    res.json({ ok: true })
  })().catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
})

socialRouter.delete('/friends/:friendId', requireAuth, (req: Request, res: Response) => {
  void (async () => {
    const friendId = Number(req.params.friendId)
    if (!Number.isFinite(friendId)) {
      res.status(400).json({ error: '参数无效' })
      return
    }
    await run('DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)', [
      req.user!.id,
      friendId,
      friendId,
      req.user!.id
    ])
    res.json({ ok: true })
  })().catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
})

socialRouter.get('/leaderboard', requireAuth, (_req: Request, res: Response) => {
  void (async () => {
    const size = Math.min(Math.max(await getConfigNumber('leaderboard_size', 50), 10), 200)
    const rows = await all<{
      user_id: number
      name: string
      realm_label: string
      realm_index: number
      power_m: number
      power_e: number
    }>(
      'SELECT user_id, name, realm_label, realm_index, power_m, power_e FROM profiles ORDER BY realm_index DESC, power_e DESC, power_m DESC LIMIT ?',
      [size]
    )
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
  })().catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
})

socialRouter.get('/chat/history', requireAuth, (_req: Request, res: Response) => {
  void (async () => {
    // 默认 200 条:留存 7 天但只回最近 50 条的话,刷新后还是像「记录丢了」;上限放到 500 供 GM 调大
    const size = Math.min(Math.max(await getConfigNumber('chat_history_size', 200), 10), 500)
    // 只回留存期内的记录(与定时清理同参数)
    const days = Math.max(await getConfigNumber('chat_retention_days', 7), 1)
    const rows = await all<{ id: number; user_id: number; name: string; content: string; created_at: number }>(
      'SELECT id, user_id, name, content, created_at FROM chat_messages WHERE created_at >= ? ORDER BY id DESC LIMIT ?',
      [Date.now() - days * 86_400_000, size]
    )
    rows.reverse()
    res.json({ messages: rows })
  })().catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
})

/** 在线状态心跳:WS 不可用(反代不支持升级)时的 REST 兜底,顺带回当前在线名单 */
socialRouter.get('/presence', requireAuth, (req: Request, res: Response) => {
  touchPresence(req.user!.id, req.user!.username)
  res.json({ online: onlineList(), count: onlineCount() })
})

// REST 聊天限速:WS 通道在 ws.ts 内记 lastChatAt,REST 通道单独记账
const restChatLast = new Map<number, number>()

/** WS 不通时的聊天发送兜底:同样限速、落库并全服广播 */
socialRouter.post('/chat/send', requireAuth, (req: Request, res: Response) => {
  void (async () => {
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>
    const content = typeof body.content === 'string' ? body.content : ''
    const [minInterval, maxLen] = await Promise.all([
      getConfigNumber('chat_min_interval_ms', 1200),
      getConfigNumber('chat_max_len', 120)
    ])
    const text = content.trim().slice(0, maxLen)
    if (text === '') {
      res.json({ ok: true })
      return
    }
    const now = Date.now()
    const last = restChatLast.get(req.user!.id) ?? 0
    if (now - last < minInterval) {
      res.status(429).json({ error: '发言太快' })
      return
    }
    restChatLast.set(req.user!.id, now)
    if (restChatLast.size > 1000) {
      for (const [uid, at] of restChatLast) {
        if (now - at > 300_000) restChatLast.delete(uid)
      }
    }
    await run('INSERT INTO chat_messages (user_id, name, content, created_at) VALUES (?, ?, ?, ?)', [
      req.user!.id,
      req.user!.username,
      text,
      now
    ])
    broadcastAll({ type: 'chat', from: { id: req.user!.id, name: req.user!.username }, content: text, at: now })
    res.json({ ok: true })
  })().catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
})

/** 游戏关键参数下发(公告等;改参走 GM 后台) */
socialRouter.get('/config', requireAuth, (_req: Request, res: Response) => {
  void (async () => {
    const { allConfig } = await import('../config.js')
    res.json({ config: await allConfig() })
  })().catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
})

socialRouter.post('/pvp', requireAuth, (req: Request, res: Response) => {
  void (async () => {
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>
    const targetId = typeof body.targetId === 'number' && Number.isFinite(body.targetId) ? Math.trunc(body.targetId) : 0
    if (targetId === req.user!.id) {
      res.status(400).json({ error: '不能与自己对练' })
      return
    }
    const mine = await getProfileRow(req.user!.id)
    const theirs = await getProfileRow(targetId)
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
  })().catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
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
