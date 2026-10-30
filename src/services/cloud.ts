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
  /** VIP 到期毫秒时间戳;缺省/0 = 未开通(登录响应老服务端可能不带) */
  vipUntil?: number
}

/** VIP 自助开通档位(与 GM 定价四档一致) */
export type VipPurchaseType = 'month' | 'half' | 'year' | 'forever'

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
  /** 妖王成长:本周期击杀次数 / 当前强度倍率 / 周期重置时刻 */
  growth: { killCount: number; mult: number; resetAt: number }
  /** 托管预判:这一剑能伤多少、够不够补刀、托管此刻该不该出剑 */
  assess?: {
    worthIt: boolean
    steady: boolean
    canFinish: boolean
    hpShare: number
    projected: GEJson
    reason: 'finish' | 'steady' | 'hold' | 'last-call' | 'no-profile' | 'no-boss'
  }
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

// ---- 会话失效统一下线 ----
// 两类 401 都要下线:
//   kicked  = 被新设备挤下线(宽限期内旧 token 仍可写存档 → 先最后一推再登出)
//   session = token 彻底失效(密钥变更/改密作废/自然过期;服务端再也不会放行,直接登出)
// 服务端给这两类 401 打了 code;业务类 401(如改口令时「当前口令不对」)没有 code,不会触发。

type SessionEndReason = 'kicked' | 'expired'
type SessionEndHandler = (reason: SessionEndReason) => void | Promise<void>
let sessionEndHandler: SessionEndHandler | null = null
/** 统一下线出口;防重入(最后一推也可能再收到 401) */
let sessionEnding = false

export function onSessionEnd(handler: SessionEndHandler): void {
  sessionEndHandler = handler
}

/** 服务端判定本会话已不可用:触发统一下线流程 */
function handleSessionEnd(reason: SessionEndReason): void {
  if (sessionEnding || sessionEndHandler === null) return
  sessionEnding = true
  void Promise.resolve(sessionEndHandler(reason)).finally(() => {
    // 留 3 秒缓冲:期间同会话的其他 401 不再重复触发
    setTimeout(() => {
      sessionEnding = false
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
    // 会话级 401:被挤下线 / token 失效,统一走下线流程(kicked 先推最后一版存档,expired 直接下线)
    if (res.status === 401 && (code === 'kicked' || code === 'session')) {
      handleSessionEnd(code === 'kicked' ? 'kicked' : 'expired')
    }
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
  /** 会话信息刷新:取最新 VIP 状态(GM 发放/续期后无需重登) */
  me: (): Promise<{ user: CloudUser }> => request('GET', '/auth/me'),
  /** VIP 激活码兑换:成功返回 days(0=永久)与新到期时间 */
  redeemVip: (code: string): Promise<{ ok: boolean; days: number; vipUntil: number }> =>
    request('POST', '/vip/redeem', { code }),
  /** 支付宝当面付:定价与开关(未登录也可读,界面自行判断) */
  vipPricing: (): Promise<{ enabled: boolean; prices: Record<VipPurchaseType, number> }> =>
    request('GET', '/vip/pricing'),
  /** 创建当面付订单:返回二维码 dataURL 与有效期 */
  vipCreateOrder: (
    type: VipPurchaseType
  ): Promise<{ outTradeNo: string; qrDataUrl: string; amountYuan: number; days: number; expireAt: number }> =>
    request('POST', '/vip/order', { type }),
  /** 轮询订单状态:paid 时服务端已发放 VIP */
  vipOrderStatus: (outTradeNo: string): Promise<{ status: 'pending' | 'paid' | 'closed'; vipUntil?: number }> =>
    request('GET', `/vip/order/${encodeURIComponent(outTradeNo)}/status`),
  /** VIP 托管设置 + 未领取的离线讨伐所得 */
  vipAutoOps: (): Promise<{
    settings: { autoBoss: boolean; autoRetreat: boolean; autoAdventure: boolean; regionId: string; mode: string }
    pending: { stoneM: number; stoneE: number; herb: number; strikes: number; tier: number }
  }> => request('GET', '/vip/autoops'),
  /** 同步托管设置到服务端(离线托管按此代打) */
  putVipAutoOps: (s: {
    autoBoss: boolean
    autoRetreat: boolean
    autoAdventure: boolean
    regionId: string
    mode: string
  }): Promise<{ ok: boolean }> => request('PUT', '/vip/autoops', s),
  /** 领取离线讨伐所得(领取即清零) */
  collectVipAutoOps: (): Promise<{ collected: { stoneM: number; stoneE: number; herb: number; strikes: number; tier: number } }> =>
    request('POST', '/vip/autoops/collect'),
  emailCode: (email: string, purpose: 'register' | 'reset' | 'bind'): Promise<EmailCodeResp> =>
    request('POST', '/auth/email-code', { email, purpose }),
  /** 修改口令:成功后返回新 token(换上,否则本会话作废) */
  changePassword: (oldPassword: string, newPassword: string): Promise<{ ok: boolean; token: string }> =>
    request('POST', '/auth/change-password', { oldPassword, newPassword }),
  /** 修改绑定邮箱:邮箱服务开启时需先对新邮箱发验证码(purpose=bind) */
  changeEmail: (password: string, email: string, code = ''): Promise<{ ok: boolean; email: string }> =>
    request('POST', '/auth/change-email', { password, email, code }),
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
      handleSessionEnd('kicked')
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
