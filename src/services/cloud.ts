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

/** 存档历史条目(不含档体) */
export interface SaveHistoryRow {
  id: number
  version: number
  realm_index: number
  size: number
  updated_at: number
  created_at: number
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
  | { type: 'room_join'; code: string; name: string; dungeon: string; at: number }
  | { type: 'room_leave'; code: string; name: string; dungeon: string; at: number }
  | { type: 'dungeon_result'; dungeon: string; name: string; by: string; win: boolean; stone: number; herb: number; at: number }
  | { type: 'kick'; graceMs: number }
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

// ---- 多人副本(房间码) ----

export type DungeonKey = 'demon' | 'explore' | 'guard' | 'array'

export interface DungeonRoom {
  code: string
  dungeon: DungeonKey
  leaderId: number
  members: Array<{ userId: number; name: string }>
}

export interface DungeonBrief {
  key: DungeonKey
  name: string
  desc: string
  used: number
  max: number
}

export interface DungeonOverview {
  dungeons: DungeonBrief[]
  maxSize: number
  room: DungeonRoom | null
}

export interface DungeonRunResult {
  dungeon: DungeonKey
  name: string
  roomSize: number
  win: boolean
  log: string[]
  reward: { stone: number; herb: number }
}

export class CloudError extends Error {
  /** HTTP 状态码;网络不通为 0 */
  readonly status: number
  /** 服务端业务码(如 conflict / empty_overwrite / kicked) */
  readonly code: string

  constructor(message: string, status = 0, code = '') {
    super(message)
    this.status = status
    this.code = code
  }
}

// ---- 单设备登录:被挤下线 ----
// 服务端在新设备登录后作废旧会话;旧设备通过 WS kick 消息或任意 REST 401(code=kicked)得知,
// 统一走这里注册的回调(最后一推存档 → 本地登出 → 跳登录页),由界面层(App.vue)注册。

type KickedHandler = () => void | Promise<void>
let kickedHandler: KickedHandler | null = null
/** 被挤下线的统一出口;防重入(最后一推也可能再收到 401) */
let kicking = false

export function onKicked(handler: KickedHandler): void {
  kickedHandler = handler
}

/** 服务端判定本会话已被挤下线:触发统一下线流程 */
function handleKicked(): void {
  if (kicking || kickedHandler === null) return
  kicking = true
  void Promise.resolve(kickedHandler()).finally(() => {
    // 留 3 秒缓冲:期间同会话的其他 401 不再重复触发
    setTimeout(() => {
      kicking = false
    }, 3000)
  })
}

export interface AuthConfig {
  /** 注册是否强制邮箱验证码(预留开关,服务端 EMAIL_CODE_REQUIRED) */
  emailCodeRequired: boolean
  /** 服务端是否已配置 SMTP 实发邮件 */
  emailEnabled: boolean
  /** 云存档自动上传间隔(秒);服务端 game_config.save_push_interval_sec,老后端缺省 undefined */
  saveIntervalSec?: number
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
    const obj = typeof json === 'object' && json !== null ? (json as { error?: unknown; code?: unknown }) : {}
    const msg = typeof obj.error === 'string' ? obj.error : '请求失败'
    const code = typeof obj.code === 'string' ? obj.code : ''
    // 会话被新设备顶掉:统一走挤下线流程(旧设备最后的存档上报也走这里,宽限期内仍可写)
    if (res.status === 401 && code === 'kicked') handleKicked()
    throw new CloudError(msg, res.status, code)
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
  putSave: (payload: {
    version: number
    data: Record<string, unknown>
    profile: unknown
    /** 本机上次同步到的云端时间戳:服务端据此判断是否被别的设备改过 */
    baseUpdatedAt?: number
  }): Promise<{ ok: boolean; updatedAt: number }> => request('PUT', '/save', payload),
  saveHistory: (limit = 30): Promise<{ history: SaveHistoryRow[] }> =>
    request('GET', `/save/history?limit=${limit}`),
  restoreSave: (historyId: number): Promise<{ ok: boolean; updatedAt: number }> =>
    request('POST', '/save/restore', { historyId }),
  friends: (): Promise<FriendsData> => request('GET', '/friends'),
  presence: (): Promise<{ online: Array<{ id: number; name: string }>; count: number }> =>
    request('GET', '/presence'),
  chatSend: (content: string): Promise<{ ok: boolean }> => request('POST', '/chat/send', { content }),
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
  bossStrike: (): Promise<BossStrikeResult> => request('POST', '/boss/strike'),
  dungeonOverview: (): Promise<DungeonOverview> => request('GET', '/dungeon'),
  dungeonRoom: (): Promise<{ room: DungeonRoom | null }> => request('GET', '/dungeon/room'),
  dungeonRoomCreate: (dungeon: DungeonKey): Promise<{ room: DungeonRoom }> =>
    request('POST', '/dungeon/room', { dungeon }),
  dungeonRoomJoin: (code: string): Promise<{ room: DungeonRoom; leftCode: string; full: boolean }> =>
    request('POST', '/dungeon/room/join', { code }),
  dungeonRoomLeave: (): Promise<{ ok: boolean }> => request('POST', '/dungeon/room/leave'),
  dungeonRun: (dungeon: DungeonKey, code = ''): Promise<DungeonRunResult> =>
    request('POST', '/dungeon/run', { dungeon, code })
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
  // REST 心跳兜底与 WS 并行:WS 正常时 presence 广播为准,WS 被反代挡掉时轮询保底
  startPresencePoll()
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
    if (msg.type === 'kick') {
      // 服务端已在宽限窗口后强关连接;这里立即走统一下线流程(最后一推存档 → 登出 → 登录页)
      handleKicked()
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
  stopPresencePoll()
}

// ---- 在线状态 REST 兜底 ----
// 反代不支持 WebSocket 升级时,WS 常连不上,在线人数会一直显示 0;
// 这里每 30s 用 /api/presence 心跳保底,并把名单广播给订阅方(与 WS presence 同通道)。

let presenceTimer: ReturnType<typeof setInterval> | undefined

function dispatchPresence(online: Array<{ id: number; name: string }>): void {
  const msg: CloudWsMsg = { type: 'presence', online }
  for (const h of handlers) h(msg)
}

function pollPresence(): void {
  const auth = useAuthStore()
  if (!auth.loggedIn) return
  void cloudApi
    .presence()
    .then(res => {
      dispatchPresence(res.online)
    })
    .catch(() => undefined)
}

function startPresencePoll(): void {
  if (presenceTimer !== undefined || typeof window === 'undefined') return
  pollPresence()
  presenceTimer = setInterval(pollPresence, 30_000)
}

function stopPresencePoll(): void {
  if (presenceTimer !== undefined) {
    clearInterval(presenceTimer)
    presenceTimer = undefined
  }
}

export function sendChat(content: string): boolean {
  if (ws !== null && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'chat', content }))
    return true
  }
  // WS 不通时走 REST 兜底:同样限速、落库并全服广播
  void cloudApi.chatSend(content).catch(() => undefined)
  return true
}
