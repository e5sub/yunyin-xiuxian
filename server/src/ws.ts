/** ws 网关:鉴权 / 在线状态 / 聊天广播 / 好友通知推送 / 单设备互踢 */
import type { IncomingMessage } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'
import { getConfigNumber } from './config.js'
import { verifyToken } from './auth.js'
import { get } from './db.js'

interface Client {
  uid: number
  name: string
  ws: WebSocket
}

const clients = new Map<number, Set<Client>>()

/** 按账号限速:多开连接不能绕过(连接级计数在 ws 层会被并发连接放大) */
const lastChatByUid = new Map<number, number>()

/** 旧设备的收尾等待:登录接口等这段时间再发新 token(够旧设备把存档推上来) */
export const KICK_WAIT_MS = 2500

export function initWsServer(wss: WebSocketServer): void {
  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const token = url.searchParams.get('token') ?? ''
      const session = verifyToken(token)
      if (session === null) {
        ws.close(4001, '未登录')
        return
      }
      const uid = session.uid
      // 道号一律取库里的账号名:客户端传什么都不能改身份(否则可冒充他人/GM)
      const row = await get<{ username: string; status: string; login_seq: number }>(
        'SELECT username, status, login_seq FROM users WHERE id = ?',
        [uid]
      )
      if (row === undefined || row.status !== 'active') {
        ws.close(4001, '账号不可用')
        return
      }
      // 单设备登录:会话序号对不上(旧会话)的连接直接拒掉;存档上报的宽限逻辑在 requireAuth 里
      if (session.seq !== row.login_seq) {
        ws.close(4002, '账号已在其他设备登录')
        return
      }
      const client: Client = { uid, name: row.username, ws }
      let existing = clients.get(uid)
      if (existing === undefined) {
        existing = new Set()
        clients.set(uid, existing)
      }
      const set = existing
      set.add(client)
      broadcastPresence()

      ws.on('message', raw => {
        let msg: Record<string, unknown>
        try {
          msg = JSON.parse(String(raw)) as Record<string, unknown>
        } catch {
          return
        }
        if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }))
          return
        }
        if (msg.type === 'chat' && typeof msg.content === 'string') {
          void handleChat(client, msg.content)
        }
      })

      ws.on('close', () => {
        set.delete(client)
        if (set.size === 0) clients.delete(uid)
        broadcastPresence()
      })
    })().catch(() => {
      ws.close(1011, '服务器异常')
    })
  })
}

export function isOnline(uid: number): boolean {
  return clients.has(uid)
}

/** 在线连接数(同一账号多端只计一次;含 REST 心跳兜底的在线用户) */
export function onlineCount(): number {
  return clients.size + restOnline().length
}

export function onlineList(): Array<{ id: number; name: string }> {
  const out: Array<{ id: number; name: string }> = []
  for (const [uid, set] of clients) {
    const first = set.values().next().value
    if (first !== undefined) out.push({ id: uid, name: first.name })
  }
  return out.concat(restOnline())
}

// ---- REST 心跳兜底 ----
// 反代不支持 WebSocket 升级时,客户端改用 /api/presence 轮询维持在线状态;
// 心跳超过 TTL 未续期即视为离线。

const REST_TTL_MS = 90_000
const restSeen = new Map<number, { name: string; at: number }>()

/** REST 心跳续期:uid 有 WS 连接时无须调用(WS 优先) */
export function touchPresence(uid: number, name: string): void {
  if (clients.has(uid)) return
  restSeen.set(uid, { name, at: Date.now() })
}

function restOnline(): Array<{ id: number; name: string }> {
  const now = Date.now()
  for (const [uid, v] of restSeen) {
    if (now - v.at > REST_TTL_MS || clients.has(uid)) restSeen.delete(uid)
  }
  const out: Array<{ id: number; name: string }> = []
  for (const [uid, v] of restSeen) out.push({ id: uid, name: v.name })
  return out
}

function broadcastPresence(): void {
  const payload = JSON.stringify({ type: 'presence', online: onlineList() })
  for (const set of clients.values()) {
    for (const c of set) {
      if (c.ws.readyState === WebSocket.OPEN) c.ws.send(payload)
    }
  }
}

/** 全服广播(GM 公告等);system=true 时消息来自系统身份 */
export function broadcastAll(msg: Record<string, unknown>): void {
  const payload = JSON.stringify(msg)
  for (const set of clients.values()) {
    for (const c of set) {
      if (c.ws.readyState === WebSocket.OPEN) c.ws.send(payload)
    }
  }
}

const DEFAULT_CHAT_MIN_INTERVAL_MS = 1200
const DEFAULT_CHAT_MAX_LEN = 120

async function handleChat(client: Client, content: string): Promise<void> {
  const [minInterval, maxLen] = await Promise.all([
    getConfigNumber('chat_min_interval_ms', DEFAULT_CHAT_MIN_INTERVAL_MS),
    getConfigNumber('chat_max_len', DEFAULT_CHAT_MAX_LEN)
  ])
  const text = content.trim().slice(0, maxLen)
  if (text === '') return
  const now = Date.now()
  // 按账号限速:同一账号多开连接共用一个配额
  if (now - (lastChatByUid.get(client.uid) ?? 0) < minInterval) return
  lastChatByUid.set(client.uid, now)
  if (lastChatByUid.size > 5000) {
    for (const [uid, at] of lastChatByUid) {
      if (now - at > 300_000) lastChatByUid.delete(uid)
    }
  }
  const payload = JSON.stringify({ type: 'chat', from: { id: client.uid, name: client.name }, content: text, at: now })
  for (const set of clients.values()) {
    for (const c of set) {
      if (c.ws.readyState === WebSocket.OPEN) c.ws.send(payload)
    }
  }
  // 留档交由 index.ts 通过回调落库(网关只管广播,不直接写库)
  onChatPersist?.(client.uid, client.name, text, now)
}

export let onChatPersist: ((uid: number, name: string, content: string, at: number) => void) | null = null
export function registerChatPersist(fn: (uid: number, name: string, content: string, at: number) => void): void {
  onChatPersist = fn
}

/** 主动推送给某个在线用户(好友请求等) */
export function notifyUser(uid: number, msg: Record<string, unknown>): void {
  const set = clients.get(uid)
  if (set === undefined) return
  const payload = JSON.stringify(msg)
  for (const c of set) {
    if (c.ws.readyState === WebSocket.OPEN) c.ws.send(payload)
  }
}

/**
 * 单设备互踢:通知该账号所有在线连接「你已被挤下线」。
 * 等 waitMs(给旧设备最后的存档上报窗口)后返回,closeAfterMs 后强制关闭旧连接。
 * 登录接口据此串行化:旧设备的最后一推落库后才给新设备发 token。
 */
export function kickUserSockets(uid: number, waitMs: number, closeAfterMs: number): Promise<void> {
  const set = clients.get(uid)
  if (set === undefined) return Promise.resolve()
  notifyUser(uid, { type: 'kick', graceMs: closeAfterMs })
  return new Promise(resolve => {
    setTimeout(resolve, waitMs)
    setTimeout(() => {
      const cur = clients.get(uid)
      if (cur !== undefined) {
        for (const c of cur) {
          if (c.ws.readyState === WebSocket.OPEN || c.ws.readyState === WebSocket.CONNECTING) {
            c.ws.close(4002, '账号已在其他设备登录')
          }
        }
      }
    }, closeAfterMs)
  })
}
