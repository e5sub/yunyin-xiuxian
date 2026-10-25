/**
 * 世界记忆服务:S1 区域兴衰 / S2 宿敌记忆 / S3 事件余波。
 * 约束:不新增货币 / 境界,不改核心经济,不引入高频操作,不破坏挂机;数值影响极轻,无强制 debuff。
 */
import type { RegionProsperity, RegionRecall, NemesisRecord, EventMemory } from '@/types'
import { usePlayerStore } from '@/stores/player'
import { useAdventureStore } from '@/stores/adventure'

// ============ S1: 区域兴衰 ============

/** 区域内累计胜场达到多少进入稳定 */
export const STABLE_WINS = 30
/** 累计胜场达到多少进入繁盛 */
export const FLOURISH_WINS = 80
/** 守土时长(小时):镇压后守满即成稳定 / 繁盛,不必先刷满胜场(镇压后不再产胜场) */
export const STABLE_HOURS = 6
export const FLOURISH_HOURS = 24
/** 无活动超过多少小时,兴衰回落 */
export const DECAY_HOURS = 48
/** 镇压后无活动超过多少小时,区域开始复苏(自动解除镇压) */
export const REVIVE_AFTER_HOURS = 72

/**
 * 妖气复聚的钟:最后一次战斗 / 镇压 / 靖平取最晚。
 * 复聚判定只用这一份钟(配 isRegionRevived);另按 suppressedSince 判会一个 tick 弹两条复聚提示。
 */
export function regionTouchedAt(
  lastUpdateAt: number | undefined,
  suppressedSince: number | undefined,
  clearedAt: number | undefined
): number {
  return Math.max(lastUpdateAt ?? 0, suppressedSince ?? 0, clearedAt ?? 0)
}

/** 某片地界此刻的复聚钟;结算(regionRevival)与界面倒计时(RegionCard)同读这一份 */
export function regionReviveClock(regionId: string): number {
  const player = usePlayerStore()
  const adventure = useAdventureStore()
  return regionTouchedAt(
    player.regionStats[regionId]?.lastUpdateAt,
    player.suppressedSince[regionId],
    adventure.clearedAt[regionId]
  )
}

/** 够钟(超过 REVIVE_AFTER_HOURS 小时)即妖气复聚 */
export function isRegionRevived(touchedAt: number, now: number): boolean {
  return touchedAt > 0 && (now - touchedAt) / 3600_000 > REVIVE_AFTER_HOURS
}

/** 距妖气复聚还剩多少小时;touchedAt 须与判定同一份钟(regionTouchedAt),不能只传 suppressedSince */
export function hoursUntilRevive(touchedAt: number, now: number = Date.now()): number {
  if (!(touchedAt > 0)) return 0
  return Math.max(0, REVIVE_AFTER_HOURS - (now - touchedAt) / 3600_000)
}

interface RegionStateInput {
  totalWins: number
  hasSuppressed: boolean
  suppressedAt?: number
  lastActivityAt: number
  now: number
}

/** 派生区域兴衰状态(纯函数) */
export function deriveProsperity(input: RegionStateInput): RegionRecall {
  const heldHours = input.suppressedAt !== undefined ? (input.now - input.suppressedAt) / 3600_000 : 0
  const idleHours = (input.now - input.lastActivityAt) / 3600_000
  let prosperity: RegionProsperity = 'chaos'
  if (input.hasSuppressed) {
    // suppressedAt 有值 = 仍在镇压中,按活动算(只看最后一战会在 48~72 小时误判回落);
    // 坏档只有镇压标记、缺起钟时按最后一战回落
    const alive = input.suppressedAt !== undefined || idleHours < DECAY_HOURS
    if (alive && (input.totalWins >= FLOURISH_WINS || heldHours >= FLOURISH_HOURS)) {
      prosperity = 'flourish'
    } else if (alive && (input.totalWins >= STABLE_WINS || heldHours >= STABLE_HOURS)) {
      prosperity = 'stable'
    }
  }
  return {
    prosperity,
    since: input.suppressedAt ?? input.lastActivityAt,
    totalWins: input.totalWins,
    hasSuppressed: input.hasSuppressed,
    suppressedAt: input.suppressedAt
  }
}

const PROSPERITY_NAMES: Record<RegionProsperity, string> = {
  chaos: '混乱',
  stable: '稳定',
  flourish: '繁盛'
}

export function prosperityName(p: RegionProsperity): string {
  return PROSPERITY_NAMES[p]
}

/** 兴衰对镇压后被动产出的倍率(仍属轻量:产出大头在层级与时长) */
export function prosperityYieldMult(p: RegionProsperity): number {
  switch (p) {
    case 'flourish':
      return 1.1
    case 'stable':
      return 1.05
    default:
      return 1.0
  }
}

// ============ S2: 宿敌记忆 ============

/** 标记为宿敌所需败北次数 */
export const NEMESIS_THRESHOLD = 3

/** 由敌人图鉴 id 组装宿敌记录(内部用;首次败北即 lossCount=1) */
function makeNemesis(enemyId: string, enemyName: string, regionId: string, now: number): NemesisRecord {
  return { enemyId, enemyName, regionId, lossCount: 1, lastLossAt: now }
}

/** 记录一次败北:更新宿敌计数,新增或累加 */
export function recordLoss(
  nemeses: NemesisRecord[],
  enemyId: string,
  enemyName: string,
  regionId: string,
  now: number,
  threshold = NEMESIS_THRESHOLD
): { list: NemesisRecord[]; becameNemesis: boolean } {
  const existing = nemeses.find(n => n.enemyId === enemyId)
  if (existing) {
    const next = { ...existing, lossCount: existing.lossCount + 1, lastLossAt: now }
    return {
      list: nemeses.map(n => (n.enemyId === enemyId ? next : n)),
      becameNemesis: next.lossCount >= threshold
    }
  }
  const created = makeNemesis(enemyId, enemyName, regionId, now)
  return {
    list: [...nemeses.slice(-49), created],
    becameNemesis: created.lossCount >= threshold
  }
}

/** 是否已为宿敌(雪耻未完成) */
export function isNemesis(nemeses: NemesisRecord[], enemyId: string): boolean {
  const n = nemeses.find(x => x.enemyId === enemyId)
  return n !== undefined && n.lossCount >= NEMESIS_THRESHOLD && n.avengedAt === undefined
}

/**
 * 整段败北一次入账(离线整段结算用),与逐场 recordLoss 等价(旗标即逐场取或)。
 * @param times 败北次数(向下取整,非正数不动)
 * @returns 入账后的列表,以及本批是否使 isNemesis 由假转真(已过门槛不重报;雪耻永久,雪耻后不再报)
 */
export function recordLossBatch(
  nemeses: NemesisRecord[],
  enemyId: string,
  enemyName: string,
  regionId: string,
  now: number,
  times: number,
  threshold = NEMESIS_THRESHOLD
): { list: NemesisRecord[]; becameNemesis: boolean } {
  const count = Math.floor(times)
  if (!Number.isFinite(count) || count <= 0) return { list: nemeses, becameNemesis: false }
  const existing = nemeses.find(n => n.enemyId === enemyId)
  const wasNemesis = existing !== undefined && existing.lossCount >= threshold
  const next: NemesisRecord = existing
    ? { ...existing, lossCount: existing.lossCount + count, lastLossAt: now }
    : { enemyId, enemyName, regionId, lossCount: count, lastLossAt: now }
  const list = existing
    ? nemeses.map(n => (n.enemyId === enemyId ? next : n))
    : [...nemeses.slice(-49), next]
  // 与单场同义:只有「这一批把它推过门槛」才算新成宿敌,已过门槛的再败不重复播报
  return { list, becameNemesis: !wasNemesis && next.lossCount >= threshold }
}

/** 首次雪耻:记录击破宿敌时间 */
export function markAvenged(nemeses: NemesisRecord[], enemyId: string, now: number): NemesisRecord[] {
  return nemeses.map(n => (n.enemyId === enemyId && n.avengedAt === undefined ? { ...n, avengedAt: now } : n))
}

// ============ S3: 事件余波 ============

/** 再次遭遇已完成事件时,触发「余波」文案的概率 */
export const AFTERMATH_CHANCE = 0.2

/** 记录事件已完成 */
export function recordEvent(
  memories: Record<string, EventMemory>,
  eventId: string,
  choiceIdx: number,
  now: number
): Record<string, EventMemory> {
  const cur = memories[eventId]
  const next: EventMemory = cur
    ? { ...cur, times: cur.times + 1, lastAt: now, lastChoiceIdx: choiceIdx }
    : { eventId, times: 1, lastAt: now, lastChoiceIdx: choiceIdx }
  return { ...memories, [eventId]: next }
}

/** 余波触发条件:完成过即可,可反复触发 */
export function shouldTriggerAftermath(memories: Record<string, EventMemory>, eventId: string, rand: number): boolean {
  const m = memories[eventId]
  if (!m || m.times < 1) return false
  return rand < AFTERMATH_CHANCE
}

export function aftermathText(eventTitle: string, kind: 'good' | 'echo' | 'silence'): string {
  switch (kind) {
    case 'good':
      return `${eventTitle}的痕迹依旧温存,你感到一丝久违的暖意。`
    case 'echo':
      return `${eventTitle}的余韵未散,往事如画卷般在眼前展开。`
    case 'silence':
      return `${eventTitle}已然远去,只余一片寂静。`
  }
}

// ============ 通用查询(UI 用) ============

/** 当前区域兴衰;now 须可注入(界面按每秒游戏钟重算,守满时长那一刻才翻档) */
export function regionRecallFor(regionId: string, now = Date.now()): RegionRecall {
  const player = usePlayerStore()
  const stats = player.regionStats[regionId]
  return deriveProsperity({
    // 胜场取本世 regionWins,不取 regionStats.totalFights
    totalWins: regionWinsOfThisLife(player, regionId),
    hasSuppressed: player.suppressedRegions.includes(regionId),
    // 起点取镇压时刻,不取 lastUpdateAt(否则镇压后刷战会把 since 一路前移)
    suppressedAt: player.suppressedSince[regionId],
    lastActivityAt: stats?.lastUpdateAt ?? now,
    now
  })
}

/**
 * 本世的区域胜场,兴衰判据的唯一读法。
 * regionWins 跨世保留;按 regionWinsLife 认世,世号不符视为本世 0 胜。
 */
export function regionWinsOfThisLife(
  player: ReturnType<typeof usePlayerStore>,
  regionId: string
): number {
  const life = player.suppressLife >= 0 ? player.suppressLife : player.reincarnation.count
  const tagged = player.regionWinsLife[regionId]
  // 无世号(老档 / 新档刚写)按本世认
  if (tagged === undefined || tagged < 0 || tagged === life) return player.regionWins[regionId] ?? 0
  return 0
}

// ============ 宿敌残魂 ============

/** 残魂再现概率 */
export const ECHO_GHOST_CHANCE = 0.03

/** 宿敌残魂:仅已雪耻的宿敌有;纯叙事,只改战报前缀与敌名,不改属性与奖励 */
export function ghostOf(nemeses: NemesisRecord[], enemyId: string): NemesisRecord | null {
  const n = nemeses.find(x => x.enemyId === enemyId)
  if (!n || n.avengedAt === undefined) return null
  return n
}

/** 残魂战报前缀 */
export function ghostTitle(n: NemesisRecord): string {
  return `残魂·${n.enemyName}`
}

/** 残魂引导语 (战报第一行前) */
export function ghostLeadIn(n: NemesisRecord): string {
  return `你曾${n.lossCount}败于此,又将此敌斩于剑下。如今一道残魂再度拦路——它似乎仍记得你。`
}
