/**
 * 周天七会:每日轮值活动。
 *
 * 三条硬规矩:
 *   一 换日按北京时间(UTC+8)零点,不看容器时区 —— 线上 Docker 多为 UTC,按 UTC 换日会让国内玩家早上八点才见新活动。
 *   二 进度与赏格都由服务端裁定。载体仍是既有玩法(切磋 / 围妖 / 秘境 / 天榜),
 *     服务端在这些入口顺手记一笔,客户端只负责展示与领取,改本地档改不出赏。
 *   三 活动只加「当日一条加成」,不改既有结算公式:秘境战获、围妖出剑次数、擂台对手强度各一处单点。
 */
import { get, run } from './db.js'
import { getConfig } from './config.js'

export type EventKind = 'duel' | 'arena' | 'boss' | 'dungeon' | 'board'

export interface EventReward {
  /** 灵石基础值,客户端按自身层级折算(与秘境战获同一口径) */
  stone: number
  herb: number
  wudao: number
  ore: number
  dust: number
  page: number
}

/** 活动日对载体的加成;缺省即不加成 */
export interface EventBonus {
  /** 秘境战获倍率(1.5 = +50%) */
  dungeonReward?: number
  /** 围妖当日额外出剑次数 */
  bossAttempts?: number
  /** 擂台对手三维倍率 */
  arenaFoe?: number
  /** 擂台自身气血倍率(0.6 = 只剩四成) */
  arenaSelfHp?: number
}

export interface DailyEvent {
  id: string
  /** 1 = 周一 … 7 = 周日 */
  dow: number
  name: string
  /** 两字标签,界面小格用 */
  tag: string
  desc: string
  kind: EventKind
  /** duel 胜场 / arena 连胜 / boss 出剑 / dungeon 通关;board 为名次上限 */
  target: number
  /** 规则一句话,界面直接显示 */
  rule: string
  reward: EventReward
  /** 「去办」落点(客户端路由) */
  to: string
  bonus?: EventBonus
  /** 切磋型专用:true = 胜负都计数(万剑会只看敢不敢出手) */
  duelAny?: boolean
}

const R = (v: Partial<EventReward>): EventReward => ({ stone: 0, herb: 0, wudao: 0, ore: 0, dust: 0, page: 0, ...v })

/**
 * 七天七会。同一载体只隔开用(切磋在周一/周六、秘境在周四),避免连着两天做同一件事。
 * 赏格按「一天一次、不可重复」定,约等于半次秘境或一剑围妖的收成,不至于把经济顶起来。
 */
export const EVENTS: DailyEvent[] = [
  {
    id: 'e_mon_duel',
    dow: 1,
    name: '论道会',
    tag: '论道',
    desc: '山门开坛,道友云集,以武证道。',
    kind: 'duel',
    target: 3,
    rule: '今日与道友切磋,胜三场',
    reward: R({ stone: 120, wudao: 18 }),
    to: '/friends'
  },
  {
    id: 'e_tue_arena',
    dow: 2,
    name: '试剑台',
    tag: '试剑',
    desc: '台上三关,一关强过一关。',
    kind: 'arena',
    target: 3,
    rule: '连战三关,每关对手更强;全胜方算功成',
    reward: R({ stone: 180, dust: 30 }),
    to: '/event',
    bonus: { arenaFoe: 0.95 }
  },
  {
    id: 'e_wed_boss',
    dow: 3,
    name: '妖潮夜',
    tag: '妖潮',
    desc: '妖潮拍岸,今夜可多出一剑。',
    kind: 'boss',
    target: 1,
    rule: '万妖围城出剑一次(今日出剑次数 +1)',
    reward: R({ stone: 150, herb: 20 }),
    to: '/boss',
    bonus: { bossAttempts: 1 }
  },
  {
    id: 'e_thu_dungeon',
    dow: 4,
    name: '秘境潮',
    tag: '秘境',
    desc: '地脉开合,古境战获自倍。',
    kind: 'dungeon',
    target: 1,
    rule: '秘境告捷一回(今日战获 ×1.5)',
    reward: R({ stone: 200, herb: 15 }),
    to: '/dungeon',
    bonus: { dungeonReward: 1.5 }
  },
  {
    id: 'e_fri_arena',
    dow: 5,
    name: '逆境台',
    tag: '逆境',
    desc: '气血只剩四成,仍要上台。',
    kind: 'arena',
    target: 3,
    rule: '气血只剩四成,连战三关全胜',
    reward: R({ stone: 260, wudao: 30 }),
    to: '/event',
    bonus: { arenaFoe: 1, arenaSelfHp: 0.6 }
  },
  {
    id: 'e_sat_duel',
    dow: 6,
    name: '万剑会',
    tag: '万剑',
    desc: '万剑齐鸣,不论胜负,只论敢不敢出手。',
    kind: 'duel',
    target: 5,
    rule: '今日切磋五场,不论胜负',
    reward: R({ stone: 220, page: 6 }),
    to: '/friends',
    duelAny: true
  },
  {
    id: 'e_sun_board',
    dow: 7,
    name: '天榜论剑',
    tag: '天榜',
    desc: '七日一轮,收束于天榜之上。',
    kind: 'board',
    target: 50,
    rule: '今日天榜前五十名可领重赏',
    reward: R({ stone: 400, wudao: 40, dust: 50 }),
    to: '/friends'
  }
]

const DAY_MS = 86_400_000
/** 北京时间相对 UTC 的偏移:换日以国内零点为界 */
const TZ_MS = 8 * 3600_000

/** 北京时间的日号 YYYY-MM-DD */
export function dayKeyOf(now = Date.now()): string {
  return new Date(now + TZ_MS).toISOString().slice(0, 10)
}

/** 日号 → 星期(1 = 周一 … 7 = 周日) */
export function dowOfDay(day: string): number {
  const w = new Date(`${day}T00:00:00Z`).getUTCDay()
  return w === 0 ? 7 : w
}

export function eventOfDay(day: string): DailyEvent {
  const dow = dowOfDay(day)
  return EVENTS.find(e => e.dow === dow) ?? EVENTS[0]!
}

export function todayEvent(now = Date.now()): { day: string; event: DailyEvent } {
  const day = dayKeyOf(now)
  return { day, event: eventOfDay(day) }
}

/** 距下一个北京时间零点还有多少秒(界面倒计时) */
export function secsToNextDay(now = Date.now()): number {
  return Math.max(0, Math.ceil((DAY_MS - ((now + TZ_MS) % DAY_MS)) / 1000))
}

/** 今日活动;GM 把 event_enabled 置 false 时返回 null(全站关停) */
export async function activeEvent(now = Date.now()): Promise<{ day: string; event: DailyEvent } | null> {
  if ((await getConfig('event_enabled', 'true')) === 'false') return null
  return todayEvent(now)
}

/** 活动日额外的围妖出剑次数;非妖潮夜为 0 */
export async function bossAttemptBonus(now = Date.now()): Promise<number> {
  const active = await activeEvent(now)
  if (active === null || active.event.kind !== 'boss') return 0
  return active.event.bonus?.bossAttempts ?? 0
}

/** 活动日的秘境战获倍率;非秘境潮为 1 */
export async function dungeonRewardMult(now = Date.now()): Promise<number> {
  const active = await activeEvent(now)
  if (active === null || active.event.kind !== 'dungeon') return 1
  return active.event.bonus?.dungeonReward ?? 1
}

/* ---------------- 进度 ---------------- */

export interface EventProgress {
  progress: number
  claimed: boolean
}

const EMPTY: EventProgress = { progress: 0, claimed: false }

export async function eventProgress(userId: number, day: string, eventId: string): Promise<EventProgress> {
  const row = await get<{ progress: number; claimed: number }>(
    'SELECT progress, claimed FROM event_progress WHERE user_id = ? AND day = ? AND event_id = ?',
    [userId, day, eventId]
  )
  if (row === undefined) return EMPTY
  return { progress: Math.max(0, Math.trunc(row.progress)), claimed: row.claimed === 1 }
}

async function writeProgress(userId: number, day: string, eventId: string, progress: number, claimed: boolean): Promise<void> {
  await run(
    'REPLACE INTO event_progress (user_id, day, event_id, progress, claimed, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    [userId, day, eventId, Math.max(0, Math.trunc(progress)), claimed ? 1 : 0, Date.now()]
  )
}

/** 记一笔进度;已领赏的不再累加(避免领完继续刷数字) */
export async function addEventProgress(userId: number, day: string, eventId: string, n = 1): Promise<EventProgress> {
  const cur = await eventProgress(userId, day, eventId)
  if (cur.claimed || !Number.isFinite(n) || n === 0) return cur
  const next = { progress: cur.progress + Math.trunc(n), claimed: false }
  await writeProgress(userId, day, eventId, next.progress, false)
  return next
}

/** 擂台这类「取最好成绩」的写法:只升不降 */
export async function raiseEventProgress(userId: number, day: string, eventId: string, value: number): Promise<EventProgress> {
  const cur = await eventProgress(userId, day, eventId)
  if (cur.claimed) return cur
  if (value <= cur.progress) return cur
  await writeProgress(userId, day, eventId, value, false)
  return { progress: Math.trunc(value), claimed: false }
}

/** 达标即可领一次;已领或未达标返回 null */
export async function claimEvent(userId: number, day: string, eventId: string): Promise<EventReward | null> {
  const event = EVENTS.find(e => e.id === eventId)
  const cur = await eventProgress(userId, day, eventId)
  if (event === undefined || cur.claimed || cur.progress < event.target) return null
  await writeProgress(userId, day, eventId, cur.progress, true)
  return event.reward
}

/** 天榜名次(1 起);档案未同步返回 null */
export async function leaderboardRank(userId: number): Promise<number | null> {
  const me = await get<{ realm_index: number; power_m: number; power_e: number }>(
    'SELECT realm_index, power_m, power_e FROM profiles WHERE user_id = ?',
    [userId]
  )
  if (me === undefined) return null
  const ahead = await get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM profiles
     WHERE realm_index > ? OR (realm_index = ? AND (power_e > ? OR (power_e = ? AND power_m > ?)))`,
    [me.realm_index, me.realm_index, me.power_e, me.power_e, me.power_m]
  )
  return (ahead?.n ?? 0) + 1
}
