/**
 * 网游后端客户端:REST + WebSocket
 * token 存于 auth store;API 地址取 VITE_API_BASE:
 *   显式配置优先;生产构建未配置时默认官方服务器(APK/Web/Electron 同),dev 走 vite 代理
 */
import { useAuthStore } from '@/stores/auth'

export const DEFAULT_API_BASE = 'https://yy.071717.xyz'

export const API_BASE: string =
  import.meta.env.VITE_API_BASE ?? (import.meta.env.PROD ? DEFAULT_API_BASE : '')

export interface CloudUser {
  id: number
  username: string
}

export interface CloudSaveInfo {
  version: number
  data: Record<string, unknown>
  updatedAt: number
}

export interface FriendEntry {
  id: number
  name: string
  online: boolean
  profile: { id: number; name: string; realmLabel: string; realmIndex: number; powerM: number; powerE: number } | null
}

export interface FriendsData {
  incoming: Array<{ requestId: number; user: { id: number; name: string } }>
  outgoing: Array<{ requestId: number; user: { id: number; name: string } }>
  accepted: FriendEntry[]
}

export interface LeaderRow {
  rank: number
  id: number
  name: string
  realmLabel: string
  realmIndex: number
  powerM: number
  powerE: number
}

export interface ChatMsg {
  id?: number
  /** 服务端历史接口带 user_id;实时消息带 from */
  user_id?: number
  from?: { id: number; name: string }
  name?: string
  content: string
  at: number
  created_at?: number
  self?: boolean
}

export type CloudWsMsg =
  | { type: 'presence'; online: Array<{ id: number; name: string }> }
  | { type: 'chat'; from: { id: number; name: string }; content: string; at: number }
  | { type: 'friendRequest'; from: { id: number; name: string } }
  | { type: 'friendAccepted'; by: { id: number; name: string } }
  | { type: 'boss_spawn'; name: string; at: number }
  | { type: 'boss_killed'; by: string; name: string; top: Array<{ name: string; dmgText: string }>; at: number }
  | { type: 'pong' }

export interface GEJson {
  m: number
  e: number
}

export interface BossState {
  name: string
  realmIndex: number
  alive: boolean
  hp: GEJson
  maxHp: GEJson
  respawnAt: number
  myAttempts: number
  maxAttempts: number
  myDamage: GEJson
  top: Array<{ name: string; dmg: GEJson; dmgText: string }>
}

export interface BossStrikeResult {
  damage: GEJson
  damageText: string
  rounds: number
  fell: boolean
  killed: boolean
  hp: GEJson
  maxHp: GEJson
  bossName: string
  tier: number
  reward: { stone: number; herb: number }
}

export class CloudError extends Error {}

export interface AuthConfig {
  /** 注册是否强制邮箱验证码(预留开关,服务端 EMAIL_CODE_REQUIRED) */
  emailCodeRequired: boolean
  /** 服务端是否已配置 SMTP 实发邮件 */
  emailEnabled: boolean
}

export interface EmailCodeResp {
  ok: boolean
  /** SMTP 未启用时联调用 */
  devCode?: string
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const auth = useAuthStore()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (auth.token !== '') headers.Authorization = `Bearer ${auth.token}`
  let res: Response
  try {
    res = await fetch(`${API_BASE}/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  } catch {
    throw new CloudError('网络不通')
  }
  let json: unknown = null
  try {
    json = await res.json()
  } catch {
    // 非 JSON 响应按空处理
  }
  if (!res.ok) {
    const msg =
      typeof json === 'object' && json !== null && typeof (json as { error?: unknown }).error === 'string'
        ? (json as { error: string }).error
        : '请求失败'
    throw new CloudError(msg)
  }
  return json as T
}

export const cloudApi = {
  authConfig: (): Promise<AuthConfig> => request('GET', '/auth/config'),
  register: (username: string, email: string, password: string, code = ''): Promise<{ token: string; user: CloudUser }> =>
    request('POST', '/auth/register', { username, email, password, code }),
  login: (username: string, password: string): Promise<{ token: string; user: CloudUser }> =>
    request('POST', '/auth/login', { username, password }),
  emailCode: (email: string, purpose: 'register' | 'reset'): Promise<EmailCodeResp> =>
    request('POST', '/auth/email-code', { email, purpose }),
  forgot: (email: string): Promise<EmailCodeResp> => request('POST', '/auth/forgot', { email }),
  resetPassword: (email: string, code: string, password: string): Promise<{ ok: boolean }> =>
    request('POST', '/auth/reset', { email, code, password }),
  deleteSave: (): Promise<{ ok: boolean }> => request('DELETE', '/save'),
  getSave: (): Promise<{ save: CloudSaveInfo | null }> => request('GET', '/save'),
  putSave: (payload: { version: number; data: Record<string, unknown>; profile: unknown }): Promise<{ ok: boolean }> =>
    request('PUT', '/save', payload),
  friends: (): Promise<FriendsData> => request('GET', '/friends'),
  friendRequest: (username: string): Promise<{ ok: boolean; accepted?: boolean }> =>
    request('POST', '/friends/request', { username }),
  friendRespond: (requestId: number, accept: boolean): Promise<{ ok: boolean }> =>
    request('POST', '/friends/respond', { requestId, accept }),
  friendRemove: (friendId: number): Promise<{ ok: boolean }> => request('DELETE', `/friends/${friendId}`),
  leaderboard: (): Promise<{ board: LeaderRow[] }> => request('GET', '/leaderboard'),
  chatHistory: (): Promise<{ messages: ChatMsg[] }> => request('GET', '/chat/history'),
  pvp: (targetId: number): Promise<{ winner: 'me' | 'target'; rounds: number; log: string[] }> =>
    request('POST', '/pvp', { targetId }),
  boss: (): Promise<BossState> => request('GET', '/boss'),
  bossStrike: (): Promise<BossStrikeResult> => request('POST', '/boss/strike')
}

// ---- WebSocket:聊天 / 在线状态 / 好友通知 ----

const handlers = new Set<(msg: CloudWsMsg) => void>()
let ws: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | undefined
let reconnectDelay = 3000

export function onCloudWs(handler: (msg: CloudWsMsg) => void): () => void {
  handlers.add(handler)
  return () => {
    handlers.delete(handler)
  }
}

export function connectCloudWs(): void {
  if (typeof window === 'undefined' || ws !== null) return
  const auth = useAuthStore()
  if (!auth.loggedIn) return
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  const base = API_BASE === '' ? `${proto}://${location.host}` : API_BASE.replace(/^http/, 'ws')
  try {
    ws = new WebSocket(`${base}/ws?token=${encodeURIComponent(auth.token)}`)
  } catch {
    scheduleReconnect()
    return
  }
  ws.onopen = () => {
    reconnectDelay = 3000
  }
  ws.onmessage = ev => {
    let msg: CloudWsMsg
    try {
      msg = JSON.parse(String(ev.data)) as CloudWsMsg
    } catch {
      return
    }
    for (const h of handlers) h(msg)
  }
  ws.onclose = () => {
    ws = null
    scheduleReconnect()
  }
  ws.onerror = () => {
    // 交给 onclose 统一重连
  }
}

function scheduleReconnect(): void {
  if (reconnectTimer !== undefined) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined
    connectCloudWs()
    reconnectDelay = Math.min(reconnectDelay * 2, 30000)
  }, reconnectDelay)
}

export function disconnectCloudWs(): void {
  if (reconnectTimer !== undefined) {
    clearTimeout(reconnectTimer)
    reconnectTimer = undefined
  }
  ws?.close()
  ws = null
}

export function sendChat(content: string): boolean {
  if (ws === null || ws.readyState !== WebSocket.OPEN) return false
  ws.send(JSON.stringify({ type: 'chat', content }))
  return true
}
