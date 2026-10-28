/** ws 网关:鉴权 / 在线状态 / 聊天广播 / 好友通知推送 */
import type { IncomingMessage } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'
import { getConfigNumber } from './config.js'
import { verifyToken } from './auth.js'

interface Client {
  uid: number
  name: string
  ws: WebSocket
  lastChatAt: number
}

const clients = new Map<number, Set<Client>>()

export function initWsServer(wss: WebSocketServer): void {
  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const token = url.searchParams.get('token') ?? ''
    const uid = verifyToken(token)
    if (uid === null) {
      ws.close(4001, '未登录')
      return
    }
    // 道号取注册名;进入游戏后档案名一致,此处够用
    const client: Client = { uid, name: url.searchParams.get('name') ?? `道友${uid}`, ws, lastChatAt: 0 }
    let set = clients.get(uid)
    if (set === undefined) {
      set = new Set()
      clients.set(uid, set)
    }
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
      set!.delete(client)
      if (set!.size === 0) clients.delete(uid)
      broadcastPresence()
    })
  })
}

export function isOnline(uid: number): boolean {
  return clients.has(uid)
}

/** 在线连接数(同一账号多端只计一次) */
export function onlineCount(): number {
  return clients.size
}

export function onlineList(): Array<{ id: number; name: string }> {
  const out: Array<{ id: number; name: string }> = []
  for (const [uid, set] of clients) {
    const first = set.values().next().value
    if (first !== undefined) out.push({ id: uid, name: first.name })
  }
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
  if (now - client.lastChatAt < minInterval) return
  client.lastChatAt = now
  const payload = JSON.stringify({ type: 'chat', from: { id: client.uid, name: client.name }, content: text, at: now })
  for (const set of clients.values()) {
    for (const c of set) {
      if (c.ws.readyState === WebSocket.OPEN) c.ws.send(payload)
    }
  }
  // 留档交由 index.ts 通过回调落库(此处不 import db,保持网关纯粹)
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
