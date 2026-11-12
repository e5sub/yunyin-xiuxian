/**
 * 网游后端客户端:REST + WebSocket
 * token 存于 auth store;API 地址取 VITE_API_BASE:
 *   显式配置优先;生产构建未配置时默认官方服务器(APK/Web/Electron 同),dev 走 vite 代理
 */
import { useAuthStore } from '@/stores/auth'
import type { EquipmentInstance } from '@/types'
import type { ForgeDetail, ForgeOp, ForgeSpend } from '@/core/forgeResolve'
import type { LevelDetail, LevelOp, LevelSpend } from '@/core/levelResolve'

export const DEFAULT_API_BASE = 'https://yy.071717.xyz'

/**
 * Vite 注入的环境变量。**Node 里没有 `import.meta.env`**(vendor bundle:saveSanitize /
 * profileRecompute 经各 store 的 sanitize 链间接拉到本模块),顶层直接读会抛
 * `Cannot read properties of undefined` 并让整份模块加载失败 —— 服务端反作弊层会因此静默失效。
 * 取值一律走本函数:浏览器/打包产物行为不变,Node 里退到默认值(该场景本就不发请求)。
 */
function viteEnv(): Record<string, unknown> | undefined {
  return import.meta.env as Record<string, unknown> | undefined
}

export const API_BASE: string =
  (viteEnv()?.VITE_API_BASE as string | undefined) ?? (viteEnv()?.PROD ? DEFAULT_API_BASE : '')

export interface CloudUser {
  id: number
  username: string
  /** VIP 到期毫秒时间戳;缺省/0 = 未开通(登录响应老服务端可能不带) */
  vipUntil?: number
}

/** 炼器裁决的响应(1.58.3);ok=false 时只有 reason/detail,一件未动 */
export interface ForgeOpResponse {
  ok: boolean
  /** 被拒的机读原因:cap / dust / exp / stone / empty / short / gone / frozen / 转移的拒因 */
  reason?: string
  op?: string
  /** 变更后的整件(OK 时以它为准覆盖本地;转移会给两件) */
  items?: EquipmentInstance[]
  spend?: ForgeSpend
  detail?: ForgeDetail
}

/** 升级裁决的响应(1.59.0:功法进修 / 建筑升级);ok=false 时只有 reason,一级未升 */
export interface LevelOpResponse {
  ok: boolean
  /** 被拒的机读原因:gone / cap / wudao / page / both / realm / max / gate / stone / ore / empty */
  reason?: string
  op?: string
  /** 变更分片:顶层键级(OK 时按它覆盖本地;只含有改动的分片与键) */
  slices?: Record<string, Record<string, unknown>>
  spend?: LevelSpend
  detail?: LevelDetail
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
  | {
      type: 'boss_killed'
      by: string
      name: string
      top: Array<{ name: string; dmgText: string }>
      /** 击杀赏分发规模与装备归属(老服务端不带) */
      recipients?: number
      equipWinner?: string | null
      at: number
    }
  | { type: 'room_join'; code: string; name: string; dungeon: string; at: number }
  | { type: 'room_leave'; code: string; name: string; dungeon: string; at: number }
  | {
      type: 'dungeon_result'
      dungeon: string
      name: string
      by: string
      difficulty?: DungeonDifficulty
      difficultyName?: string
      win: boolean
      stone: number
      herb: number
      /** 首领战况(1.59.2);老服务端不带此字段 */
      boss?: DungeonBossReport | null
      at: number
    }
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
  /** 托管预判:这一剑能伤多少、够不够补刀、托管此刻该不该出剑(按所传难度档评估) */
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
  /** 击杀赏待领:妖王被推倒时按功分发至此,领取即入账 */
  pending: { stone: number; herb: number; equip: boolean }
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
  /** 出剑本身无资粮;击杀赏走 pending 台账领取 */
  reward: { stone: number; herb: number }
  difficulty: 'calm' | 'normal' | 'peril'
  difficultyName: string
  /** 击杀时的分发规模与装备归属(未击杀为 0/null) */
  recipients: number
  equipWinner: string | null
}

// ---- 多人副本(房间码) ----

export type DungeonKey = 'demon' | 'explore' | 'guard' | 'array'

/** 副本难度:循境(稳)/ 常探(标准)/ 绝境(凶险而厚报)/ 炼狱(极凶,赏最厚) */
export type DungeonDifficulty = 'calm' | 'normal' | 'peril' | 'abyss'

export interface DungeonDifficultyBrief {
  key: DungeonDifficulty
  name: string
  desc: string
  /** 妖物强度倍率(未叠境界) */
  power: number
  /** 战获倍率(未叠境界) */
  reward: number
}

export interface DungeonRoom {
  code: string
  dungeon: DungeonKey
  difficulty: DungeonDifficulty
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

/** 凶险成长:某副本本周期击杀数与当前强度倍率(每 30 天重置,组队开拔以房主为准) */
export interface DungeonGrowthBrief {
  kills: number
  mult: number
  resetAt: number
}

export interface DungeonOverview {
  dungeons: DungeonBrief[]
  maxSize: number
  room: DungeonRoom | null
  difficulties: DungeonDifficultyBrief[]
  /** 我的境界基准:独行开局的默认强度/战获倍率 */
  myRealm: { index: number; label: string; power: number; reward: number }
  /** 我各副本的凶险成长(按 dungeon key 索引) */
  myGrowth: Partial<Record<DungeonKey, DungeonGrowthBrief>>
}

/**
 * 首领战况(1.59.2):这一场把首领打成什么样。
 * 战报是逐行文字,心魔战还会把后六轮折成「……」,只看日志判不出有没有斩杀;
 * 服务端把结果单独结出来,前端直接画条读账。
 */
export interface DungeonBossReport {
  /** 首领名(合体心魔 / 守到的那一波妖物 / 最凶的那只伏击妖兽) */
  name: string
  /** 起始气血(文本,已折成万/亿) */
  hpStart: string
  /** 剩余气血(文本;击破时为 0) */
  hpLeft: string
  /** 剩余百分比 0~100 */
  leftPct: number
  /** 是否击破 */
  killed: boolean
  /** 已战轮次 / 总轮次(守卫则是波次) */
  rounds: number
  roundsTotal: number
  /** 轮次口径:斗法「轮」,守卫「波」 */
  unit: 'round' | 'wave'
}

export interface DungeonRunResult {
  dungeon: DungeonKey
  name: string
  difficulty: DungeonDifficulty
  difficultyName: string
  /** 本场实算倍率(难度 × 境界基准 × 凶险成长) */
  scaling: { power: number; reward: number; avgRealm: number }
  /** 本场基准人的凶险成长(独行即自己,组队即房主) */
  growth: { kills: number; mult: number; resetAt: number }
  roomSize: number
  win: boolean
  /** 首领战况;共修大阵等无首领的副本为 null */
  boss: DungeonBossReport | null
  log: string[]
  /** 高难(绝境/炼狱)获胜后服务端掷中的装备掉落:领取时按自身境界生成 */
  equipDrop: boolean
  /** 活动日战获倍率(秘境潮 ×1.5;平日 1) */
  eventBoon?: number
  reward: { stone: number; herb: number }
}

// ---- 周天七会:每日轮值活动(服务端权威) ----

export type EventKind = 'duel' | 'arena' | 'boss' | 'dungeon' | 'board'

export interface EventReward {
  /** 灵石基础值,按自身层级折算(与秘境战获同口径) */
  stone: number
  herb: number
  wudao: number
  ore: number
  dust: number
  page: number
}

export interface DailyEventView {
  id: string
  /** 1 = 周一 … 7 = 周日 */
  dow: number
  name: string
  tag: string
  desc: string
  kind: EventKind
  /** duel 胜场 / arena 连胜 / boss 出剑 / dungeon 通关;board 为名次上限 */
  target: number
  rule: string
  reward: EventReward
  to: string
  duelAny?: boolean
  bonus?: { dungeonReward?: number; bossAttempts?: number; arenaFoe?: number; arenaSelfHp?: number }
}

export interface EventToday {
  enabled: boolean
  /** 北京时间日号;换日以它为准,不看本机时区 */
  day: string
  now: number
  secsToNext: number
  event: DailyEventView
  mine: { progress: number; claimed: boolean }
  /** 天榜型活动给出当前名次 */
  rank: number | null
  week: DailyEventView[]
}

export interface EventArenaRun {
  round: number
  foe: string
  win: boolean
  rounds: number
  log: string[]
}

/** 闲趣赏格:与七会同形,灵石为基础值,客户端按自身层级折算 */
export interface LeisureReward {
  stone: number
  herb: number
  wudao: number
  ore: number
  dust: number
  page: number
}

export interface LeisureFortune {
  /** 签号,同一天同一个人固定 */
  index: number
  /** 3 大吉 / 2 吉 / 1 小吉 / 0 平 */
  rank: number
  grade: string
  poem: string
  read: string
  reward: LeisureReward
}

export interface LeisureToday {
  enabled: boolean
  day: string
  now: number
  secsToNext: number
  star: { drawn: boolean; fortune: LeisureFortune | null }
  fish: { casts: number; max: number; basket: LeisureReward; caught: string[]; claimed: boolean }
  riddle: { q: string; options: string[]; answered: boolean; correct: boolean | null; note: string | null }
}

export interface LeisureStarResult {
  fortune: LeisureFortune
  /** 今日首抽才有;重复点开为全零 */
  reward: LeisureReward
  already: boolean
}

export interface LeisureCastResult {
  catch: { id: string; label: string; reward: LeisureReward }
  basket: LeisureReward
  caught: string[]
  casts: number
  max: number
}

export interface LeisureRiddleResult {
  correct: boolean
  /** 正确答案下标,答后才下发 */
  answer: number
  note: string
  reward: LeisureReward
  already: boolean
}

export interface EventArenaResult {
  day: string
  eventId: string
  runs: EventArenaRun[]
  streak: number
  mine: { progress: number; claimed: boolean }
  target: number
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
// 另有一类 403 也下线:
//   banned  = 账号被封禁(服务端 users.status != 'active',登录与一切鉴权接口都不放行)。
//             绝不做最后一推 —— 封禁后服务端本来就不再收档,客户端也别再试。
// 服务端给这几类都打了 code;业务类 401(如改口令时「当前口令不对」)没有 code,不会触发。

type SessionEndReason = 'kicked' | 'expired' | 'banned'
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
  /** Turnstile 人机验证是否启用(注册/找回口令/发验证码) */
  turnstileEnabled?: boolean
  /** Turnstile 站点密钥(启用时下发) */
  turnstileSiteKey?: string
}

export interface EmailCodeResp {
  ok: boolean
  /** SMTP 未启用时联调用 */
  devCode?: string
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const auth = useAuthStore()
  // 记下本次请求实际带的 token:改密/重登会换 token,在途旧请求回来时 401 只代表
  // 「这枚旧 token 失效了」,不该把已经换上新凭证的会话整条踢下线(1.62.0)
  const sentToken = auth.token
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (sentToken !== '') headers.Authorization = `Bearer ${sentToken}`
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
    // 会话级 401:被挤下线 / token 失效,统一走下线流程(kicked 先推最后一版存档,expired 直接下线)。
    // 只认「当前会话仍是发请求那枚 token」的 401:token 已换(改密返回新 token、重登)说明
    // 失效的是旧凭证,调用方自己会按错误处理,不该触发统一下线。
    const tokenUnchanged = useAuthStore().token === sentToken
    if (res.status === 401 && (code === 'kicked' || code === 'session') && tokenUnchanged) {
      handleSessionEnd(code === 'kicked' ? 'kicked' : 'expired')
    }
    // 封禁 403:只在带 token 的请求上触发 —— 登录接口试封禁号也会拿到 banned,
    // 那时本机并没有会话,不该走下线流程(登录页自己会把错误亮出来)。
    if (res.status === 403 && code === 'banned' && sentToken !== '' && tokenUnchanged) {
      handleSessionEnd('banned')
    }
    throw new CloudError(msg, res.status, code)
  }
  return json as T
}

export const cloudApi = {
  authConfig: (): Promise<AuthConfig> => request('GET', '/auth/config'),
  register: (username: string, email: string, password: string, code = '', turnstileToken = ''): Promise<{ token: string; user: CloudUser }> =>
    request('POST', '/auth/register', { username, email, password, code, turnstileToken }),
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
    settings: {
      autoBoss: boolean
      autoRetreat: boolean
      autoAdventure: boolean
      regionId: string
      mode: string
      bossDifficulty: 'calm' | 'normal' | 'peril'
    }
    pending: { stoneM: number; stoneE: number; herb: number; strikes: number; tier: number }
  }> => request('GET', '/vip/autoops'),
  /** 同步托管设置到服务端(离线托管按此代打) */
  putVipAutoOps: (s: {
    autoBoss: boolean
    autoRetreat: boolean
    autoAdventure: boolean
    regionId: string
    mode: string
    bossDifficulty: 'calm' | 'normal' | 'peril'
  }): Promise<{ ok: boolean }> => request('PUT', '/vip/autoops', s),
  /** 领取离线讨伐所得(领取即清零) */
  collectVipAutoOps: (): Promise<{ collected: { stoneM: number; stoneE: number; herb: number; strikes: number; tier: number } }> =>
    request('POST', '/vip/autoops/collect'),
  emailCode: (email: string, purpose: 'register' | 'reset' | 'bind', turnstileToken = ''): Promise<EmailCodeResp> =>
    request('POST', '/auth/email-code', { email, purpose, turnstileToken }),
  /** 修改口令:成功后返回新 token(换上,否则本会话作废) */
  changePassword: (oldPassword: string, newPassword: string): Promise<{ ok: boolean; token: string }> =>
    request('POST', '/auth/change-password', { oldPassword, newPassword }),
  /** 修改绑定邮箱:邮箱服务开启时需先对新邮箱发验证码(purpose=bind) */
  changeEmail: (password: string, email: string, code = ''): Promise<{ ok: boolean; email: string }> =>
    request('POST', '/auth/change-email', { password, email, code }),
  forgot: (email: string, turnstileToken = ''): Promise<EmailCodeResp> =>
    request('POST', '/auth/forgot', { email, turnstileToken }),
  resetPassword: (email: string, code: string, password: string, turnstileToken = ''): Promise<{ ok: boolean }> =>
    request('POST', '/auth/reset', { email, code, password, turnstileToken }),
  deleteSave: (): Promise<{ ok: boolean }> => request('DELETE', '/save'),
  getSave: (): Promise<{ save: CloudSaveInfo | null }> => request('GET', '/save'),
  putSave: (payload: {
    version: number
    data: Record<string, unknown>
    /** 档案快照:复算链取不到时省略,服务端保留旧 profile(不该拿空快照顶掉) */
    profile?: unknown
    /** 本机上次同步到的云端时间戳:服务端据此判断是否被别的设备改过 */
    baseUpdatedAt?: number
    /** 客户端能力标记(2 = 1.57.0+):服务端境界一律以 profiles 为准,上传里的 major/sub 只当提议 */
    realmAuth?: number
  }): Promise<{
    ok: boolean
    updatedAt: number
    /**
     * 服务端数值权威化压回的字段(境界/修为/资源/装备)。
     * 客户端须立刻用 after 覆盖本地 —— 否则本地还按作弊值显示,下个周期又被压回,数值来回跳。
     */
    corrections?: Array<{ path: string; before: unknown; after: unknown }>
  }> => request('PUT', '/save', payload),
  /**
   * 服务端权威突破:掷点与渡劫推演只在服务端做,成败都回传被改动的字段。
   * outcome 为裁决结果(成败/是否大关/劫报/前后境界);slices 按分片分组只含变更的顶层键。
   * ok=false 时突破未发生(门槛不满足等原因),reason 是给玩家看的文案。
   */
  resolveBreakthrough: (payload: { exp?: unknown; qi?: number }): Promise<{
    ok: boolean
    reason?: string
    outcome?: {
      ok: boolean
      reason: string
      success: boolean
      isMajor: boolean
      needTribulation: boolean
      tribulationLog: string[]
      fromMajor: number
      fromSub: number
      newMajor: number
      newSub: number
    }
    slices?: Record<string, Record<string, unknown>>
  }> => request('POST', '/cultivation/breakthrough', payload),
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
  boss: (difficulty = ''): Promise<BossState> =>
    request('GET', `/boss${difficulty !== '' ? `?difficulty=${difficulty}` : ''}`),
  bossStrike: (difficulty = 'normal'): Promise<BossStrikeResult> => request('POST', '/boss/strike', { difficulty }),
  bossClaim: (): Promise<{ pending: { stone: number; herb: number; equip: boolean } }> => request('POST', '/boss/claim'),
  /**
   * 掉落签发:服务端按复算出的属性裁决数量与品质窗口,生成实例并记台账(loot_ledger)。
   * 客户端只报「在哪打」;返回的实例按申请顺序拼接,调用方逐件入包。
   */
  claimLoot: (payload: { claims: readonly unknown[] }): Promise<{ equips: EquipmentInstance[] }> =>
    request('POST', '/loot/claim', payload),
  /** 坊市成交记账(1.58.1):服务端按货架复算价并落账,上传时把这笔钱从增量里扣掉 */
  marketBuy: (payload: { stockedAt: number; idx: number }): Promise<{ ok: boolean; recorded: boolean }> =>
    request('POST', '/market/buy', payload),
  /** 法宝/器魂签发(1.58.1):入台账后上传才不会在验源时被移除 */
  claimLootExtras: (payload: {
    artifacts?: readonly string[]
    souls?: readonly { uid: string; type: string; grade: number }[]
  }): Promise<{ artifacts: string[]; souls: string[] }> => request('POST', '/loot/extras', payload),
  /**
   * 炼器裁决(1.58.3):强化/重铸/自动重铸/词条转移的唯一写入口。
   * 服务端从云档无头水合后掷点,回传变更的整件与「该扣多少」;成功时以 items 为准覆盖本地。
   */
  forgeOp: (payload: {
    op: ForgeOp
    exp?: { m: number; e: number }
    dust?: number
    stone?: { m: number; e: number }
  }): Promise<ForgeOpResponse> => request('POST', '/forge/op', payload),
  /**
   * 升级裁决(1.59.0):功法进修 / 建筑升级的唯一写入口。
   * 服务端从云档无头水合后算价扣款,回传改动的分片与「该扣多少」;成功时以 slices 为准覆盖本地。
   */
  progressOp: (payload: {
    op: LevelOp
    wudao?: number
    page?: number
    ore?: number
    stone?: { m: number; e: number }
  }): Promise<LevelOpResponse> => request('POST', '/progress/op', payload),
  dungeonOverview: (): Promise<DungeonOverview> => request('GET', '/dungeon'),
  dungeonRoom: (): Promise<{ room: DungeonRoom | null }> => request('GET', '/dungeon/room'),
  dungeonRoomCreate: (dungeon: DungeonKey, difficulty: DungeonDifficulty = 'normal'): Promise<{ room: DungeonRoom }> =>
    request('POST', '/dungeon/room', { dungeon, difficulty }),
  dungeonRoomJoin: (code: string): Promise<{ room: DungeonRoom; leftCode: string; full: boolean }> =>
    request('POST', '/dungeon/room/join', { code }),
  dungeonRoomLeave: (): Promise<{ ok: boolean }> => request('POST', '/dungeon/room/leave'),
  dungeonRun: (dungeon: DungeonKey, code = '', difficulty: DungeonDifficulty = 'normal'): Promise<DungeonRunResult> =>
    request('POST', '/dungeon/run', { dungeon, code, difficulty }),
  /** 今日活动:定义 + 我的进度 + 天榜名次 + 七日一览 */
  eventToday: (): Promise<EventToday> => request('GET', '/event/today'),
  /** 领活动赏(达标且未领) */
  eventClaim: (): Promise<{ reward: EventReward; day: string; eventId: string }> => request('POST', '/event/claim', {}),
  /** 擂台连战:服务端按档案生成三关并模拟,返回逐场战报与最好连胜 */
  eventArena: (): Promise<EventArenaResult> => request('POST', '/event/arena', {}),

  // ---- 闲趣三则:观星 / 垂钓 / 猜谜 ----
  leisureToday: (): Promise<LeisureToday> => request('GET', '/leisure/today'),
  /** 抽签:一日一签,抽过再点只回看(赏为零) */
  leisureStar: (): Promise<LeisureStarResult> => request('POST', '/leisure/star', {}),
  /** 起一竿:钓获先入篓,次数用尽会报错 */
  leisureCast: (): Promise<LeisureCastResult> => request('POST', '/leisure/fish', {}),
  /** 收篓:把今日累计钓获一次入账 */
  leisureClaimBasket: (): Promise<{ reward: LeisureReward }> => request('POST', '/leisure/fish/claim', {}),
  /** 答谜:四选一,一问一次 */
  leisureAnswer: (choice: number): Promise<LeisureRiddleResult> => request('POST', '/leisure/riddle', { choice })
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

/**
 * WS 子协议名,须与服务端 ws.ts 的 WS_PROTOCOL 一致。
 * 令牌作为第二个子协议值随握手头发送:标准 WebSocket 客户端不能自定义请求头,
 * 子协议是浏览器里唯一能带凭证的通道,且不会像 ?token= 那样被反代 access log 抄进 URL。
 */
const WS_PROTOCOL = 'yunyin.v1'

/** 老服务端不认识子协议时退回 ?token=。判定要保守:连续 WS_FALLBACK_AFTER 次都在
 *  open 之前被关才降级 —— 网络未就绪/反代 502/服务器重启也表现为「没 open 就被关」,
 *  一次失败就降级会让 token 从此长期出现在 URL 与反代 access log 里(1.62.0 收紧)。
 *  连上后即复位计数;连接成功后仍允许下次会话重新尝试子协议。 */
const WS_FALLBACK_AFTER = 2
let wsProtocolFailStreak = 0
let wsUseQueryToken = false

export function connectCloudWs(): void {
  if (typeof window === 'undefined' || ws !== null) return
  const auth = useAuthStore()
  if (!auth.loggedIn) return
  // REST 心跳兜底与 WS 并行:WS 正常时 presence 广播为准,WS 被反代挡掉时轮询保底
  startPresencePoll()
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  const base = API_BASE === '' ? `${proto}://${location.host}` : API_BASE.replace(/^http/, 'ws')
  // 本条连接自己的引用:onclose 是异步派发的,登出→快速重登时旧连接的收尾
  // 不能把新连接的全局引用清掉(否则两条连接并存且有一条不受管理)
  let sock: WebSocket
  try {
    sock = wsUseQueryToken
      ? new WebSocket(`${base}/ws?token=${encodeURIComponent(auth.token)}`)
      : new WebSocket(`${base}/ws`, [WS_PROTOCOL, auth.token])
  } catch {
    scheduleReconnect()
    return
  }
  ws = sock
  // 本次连接是否真的建立过 —— 用来区分「握手被老服务端拒掉」与「连上后又被断开」
  let opened = false
  ws.onopen = () => {
    opened = true
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
    // 只清自己这条连接的全局引用,别误伤重登后的新连接
    if (ws === sock) ws = null
    if (!opened) {
      wsProtocolFailStreak += 1
      // 连续多次都没 open 就被关:多半是老服务端不认子协议(浏览器会以「未回选协议」
      // 直接判握手失败)。退回 ?token= 方式让前后端版本不同步的部署仍能连上;
      // 服务端新版本(1.62.0+)认 ?token= 兜底,不认子协议的只是更老的部署。
      if (wsProtocolFailStreak >= WS_FALLBACK_AFTER && !wsUseQueryToken) wsUseQueryToken = true
    } else {
      wsProtocolFailStreak = 0
    }
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
  // 连续失败计数随会话作废:下次登录从头数,避免旧会话的偶发网络失败累积到新会话头上
  wsProtocolFailStreak = 0
  // 降级标记也要复位:否则一次网络抖动就把之后每个会话永久钉在 ?token=
  // (令牌进 URL 与反代日志),与 1.62.0「令牌不进 URL」的收紧相悖
  wsUseQueryToken = false
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

/**
 * 发言:WS 通就走 WS,否则走 REST 兜底。
 * 返回是否真的发出去了 —— 原先 REST 失败也被吞成 true,界面清空输入框却不报错,
 * 玩家以为发出去了(而自己的发言靠服务端广播回显,横幅里其实什么都没有)。
 */
export async function sendChat(content: string): Promise<boolean> {
  if (ws !== null && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'chat', content }))
    return true
  }
  // WS 不通时走 REST 兜底:同样限速、落库并全服广播
  try {
    await cloudApi.chatSend(content)
    return true
  } catch {
    return false
  }
}
