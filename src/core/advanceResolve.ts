/**
 * 进度推进的服务端权威入口 —— 心跳产出、历练战斗与离线结算的单一裁决点。
 *
 * 为什么要有这个模块(1.75.0):
 *   此前在线 tick 的生产(修为/灵气/洞府/寿元)、历练战斗与离线收益全在客户端算,
 *   服务端只在上传时做事后钳制(saveAuthority);改包抬高 cultPerSec、把 lastActiveAt
 *   拨回去,上传窗口内无人拦。现把「时间怎么折成进度」收进这里:
 *     客户端(登录态)定期发心跳,服务端无头水合后跑同一份推进代码,把改动的分片
 *     键级 diff 回传;客户端按回传落账,本地推演只作显示预测(不跑战斗/镇压签发)。
 *     离线走同一条链:服务端时间锚点超过 OFFLINE_MIN_SECONDS 时按离线结算,
 *     归来卷轴(summary)随响应回传,客户端沿用既有弹窗展示。
 *
 * 本模块在 Node 下运行(服务端经 vendor 加载,见 scripts/build-vendor.mjs),
 * 不得 import 浏览器专属链路(audio / DOM 组件);services/cloud 可安全打包
 * (viteEnv 已函数化),且 Node 里登录态恒为未登录,签发自动走本地裁决核心(lootGrant)。
 * store 在无窗环境安全(与 core/breakthroughResolve 同一条纪律)。
 *
 * 顿悟与洞府巡游不在这里:它们是玩家在场时的 UI 弹窗流,由客户端引擎触发;
 * 它们的奖励结算收口列入后续清单(与事件选择同批)。
 */
import { createPinia, setActivePinia } from 'pinia'
import { add, gn, gnZero, gt, mulN } from '@/utils/gnum'
import { rng } from '@/utils/random'
import { AGE_YEARS_PER_HOUR, EXPLORE_MODES } from '@/data/constants'
import type { AdventureSession } from '@/types'
import { regionDef } from '@/data/regions'
import { useGameStore } from '@/stores/game'
import { usePlayerStore } from '@/stores/player'
import { useResourcesStore } from '@/stores/resources'
import { useCultivationStore } from '@/stores/cultivation'
import { useDongfuStore } from '@/stores/dongfu'
import { useAdventureStore } from '@/stores/adventure'
import { expAccrualBudget } from './saveAuthority'
import { tickExploration } from './exploration'
import { settleSuppressedRegions } from './suppress'
import { studyTick } from './loreService'
import { settleOfflineOnStores } from './offline'
import type { OfflineSummary } from '@/types'
import { rolloverDailyIfNeeded, checkStateAchievements } from './progress'
import { snapshotFromActiveStores, type ProfileSnapshot } from './profileRecompute'
import { SLICE_FACTORIES, diffSlices, isPlainObject, stateClone } from './sliceStores'

function numOf(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

/** 读 GNum;形态非法返回 null(不在这里造值) */
function gnumOf(v: unknown): { m: number; e: number } | null {
  const o = isPlainObject(v) ? v : null
  if (o === null) return null
  const m = numOf(o.m)
  const e = numOf(o.e)
  if (!Number.isFinite(m) || !Number.isFinite(e)) return null
  return { m, e }
}

/* ---------------- 共享推进:客户端预测与服务端权威走同一份生产代码 ---------------- */

export interface AdvanceOpts {
  /** 推进历练会话(战斗/事件/首领);客户端显示预测不跑 —— 战斗由服务端裁决后 patch 回填 */
  exploration?: boolean
  /** 结算镇压产出;同上,预测不跑(登录态本地跑会与服务端各发一份) */
  suppress?: boolean
}

/**
 * 单步推进上限秒数:长窗按拍循环,历练战斗每拍最多一场(与心跳节奏同量级)。
 * 离线整段不走这里,走 settleOfflineOnStores(离线口径另有效率与上限)。
 */
const ADVANCE_STEP_SEC = 5
/** 单次推进最多拍数:服务端 dt 上游钳 7 天,正常心跳 5 秒,只有丢拍补账才会连走多拍 */
const ADVANCE_MAX_STEPS = 64

/**
 * 在已激活的 store 上推进 dtSec 秒的生产(修为/灵气/洞府/藏经阁/寿元)。
 * 客户端(登录态)与引擎未登录路径共用;引擎的顿悟/洞府巡游/周期翻日不在这里。
 */
export async function advanceOnStores(dtSec: number, now: number, opts: AdvanceOpts = {}): Promise<void> {
  if (!(dtSec > 0)) return
  const player = usePlayerStore()
  const resources = useResourcesStore()
  const dongfu = useDongfuStore()
  const cultivation = useCultivationStore()
  if (player.dead) return
  const steps = Math.min(ADVANCE_MAX_STEPS, Math.max(1, Math.ceil(dtSec / ADVANCE_STEP_SEC)))
  const stepSec = dtSec / steps
  for (let i = 0; i < steps; i += 1) {
    const at = Math.round(now - (steps - 1 - i) * stepSec * 1000)
    // 天时已并入 finalStats.mods,此处不再乘天气(与引擎同一纪律)
    player.gainExp(mulN(gn(player.cultPerSec), stepSec))
    resources.setQi(resources.qi + player.qiRegenPerSec * stepSec, player.qiCapValue)
    dongfu.produce(stepSec)
    cultivation.pruneBuffs(at)
    if (opts.exploration === true) await advanceExplorationStep(at)
    if (opts.suppress === true) await settleSuppressedRegions(stepSec, rng, at)
    studyTick(stepSec)
    player.addAge((stepSec / 3600) * AGE_YEARS_PER_HOUR)
  }
}

/** 一拍到点才推进:到期判定/待处理事件/战斗节拍全在 tickExploration 里,这里只做闸门 */
async function advanceExplorationStep(at: number): Promise<void> {
  const s = useAdventureStore().session
  if (!s) return
  if (at < s.endsAt && at < s.nextBattleAt) return
  await tickExploration(at)
}

/* ---------------- 服务端入口:从云档分片无头推进 ---------------- */

export interface AdvanceClaims {
  /** 客户端当前修为(GNum);按「存量 + 本窗口可信产出」收口后采信 */
  exp?: unknown
  /** 客户端当前灵气;按积余容量收口后采信 */
  qi?: unknown
  /** 历练会话(节拍与展示用):形状合法才采信,否则整条忽略 */
  session?: unknown
}

export interface AdvanceResolveCtx {
  /** 距上次权威推进的秒数(服务端时间锚点,不采信客户端时钟) */
  dtSec: number
  /** true = 按离线结算(心跳间隔超过 OFFLINE_MIN_SECONDS) */
  offline: boolean
}

export interface AdvanceResolveResult {
  /** 被推进改动的字段,按分片分组(顶层键级 diff;只含确实变化的键) */
  patches: Record<string, Record<string, unknown>>
  /** offline 结算时的归来卷轴;在线推进为 null */
  summary: OfflineSummary | null
  /** 推进后的档案快照(给 profiles 落账用) */
  snapshot: ProfileSnapshot | null
}

/** 历练会话声明的时间窗边界:前后各放宽一小时(坏档/偏钟在此收口;1.77.0 从 ±1 天收紧) */
const SESSION_CLAIM_WINDOW_MS = 3_600_000

/**
 * 历练会话声明:非法形状/越界时间返回 undefined(整条忽略,null 表示明确清空会话)。
 * 会话只承载节拍与展示账(wins/stoneGain 等),进度由服务端自行推演,采信门槛低是刻意的。
 */
function sanitizeSessionClaim(v: unknown, now: number): AdventureSession | null | undefined {
  if (v === null) return null
  if (!isPlainObject(v)) return undefined
  const regionId = v.regionId
  if (typeof regionId !== 'string' || regionDef(regionId) === undefined) return undefined
  const mode = v.mode
  if (typeof mode !== 'string' || !(mode in EXPLORE_MODES)) return undefined
  const lo = now - SESSION_CLAIM_WINDOW_MS
  const hi = now + SESSION_CLAIM_WINDOW_MS
  const stamps: readonly number[] = [
    numOf(v.startedAt),
    numOf(v.endsAt),
    numOf(v.nextBattleAt)
  ]
  for (const val of stamps) {
    if (val < lo || val > hi) return undefined
  }
  const counter = (key: string): number => Math.max(0, Math.trunc(numOf(v[key])))
  const stone = gnumOf(v.stoneGain)
  const exp = gnumOf(v.expGain)
  return {
    regionId,
    mode: mode as AdventureSession['mode'],
    startedAt: numOf(v.startedAt),
    endsAt: numOf(v.endsAt),
    nextBattleAt: numOf(v.nextBattleAt),
    wins: counter('wins'),
    losses: counter('losses'),
    events: counter('events'),
    stoneGain: stone ?? gnZero(),
    expGain: exp ?? gnZero(),
    itemGain: counter('itemGain')
  }
}

/**
 * 从云档分片无头推进一段(服务端走这条):
 * 临时 pinia 水合 17 片 → 收口上报的修为/灵气与会话 → 跑共享推进(或离线结算) → 顶层键级 diff。
 * 形状门槛(player 分片缺 major/sub、未开局)或链路抛错返回 null,调用方拒绝推进。
 */
export async function resolveAdvanceFromSlices(
  data: unknown,
  claims: AdvanceClaims,
  ctx: AdvanceResolveCtx
): Promise<AdvanceResolveResult | null> {
  if (typeof data !== 'object' || data === null) return null
  const raw = data as Record<string, unknown>
  const game = isPlainObject(raw.game) ? raw.game : {}
  if (game.started !== true) return null
  const playerSlice = isPlainObject(raw.player) ? raw.player : null
  if (playerSlice === null || !Number.isFinite(playerSlice.major) || !Number.isFinite(playerSlice.sub)) return null
  if (!(ctx.dtSec > 0)) return null

  const pinia = createPinia()
  setActivePinia(pinia)
  try {
    for (const [id, factory] of SLICE_FACTORIES) {
      const slice = raw[id]
      if (isPlainObject(slice)) factory().$patch(slice)
    }
    const player = usePlayerStore()
    const resources = useResourcesStore()
    const adventure = useAdventureStore()

    // 会话声明先落:本窗战斗按它起拍(非法形状已被 sanitize 丢掉)
    const claimedSession = sanitizeSessionClaim(claims.session, Date.now())
    if (claimedSession !== undefined) adventure.session = claimedSession

    // 修为:上报值超出「存量 + 本窗口可信产出」的部分不采信;合法值(含合法消耗后的降低)照采
    const claimExp = gnumOf(claims.exp)
    if (claimExp !== null) {
      const stored = player.exp
      const ceiling = add(stored, expAccrualBudget(player.major, player.sub, ctx.dtSec))
      player.exp = gt(claimExp, ceiling) ? stored : claimExp
    }
    // 灵气:瞬间资源,超出积余容量的部分不采信(与突破同一条取舍)
    if (Number.isFinite(claims.qi)) {
      resources.qi = Math.min(Math.max(Math.trunc(numOf(claims.qi)), 0), Math.max(0, Math.floor(player.qiCapValue)))
    }

    const before = stateClone()
    let summary: OfflineSummary | null = null
    const now = Date.now()
    if (ctx.offline) {
      // 服务端时间锚点落进 lastActiveAt,离线结算按它起算(settle 尾部会再盖回 now)
      useGameStore().lastActiveAt = now - Math.round(ctx.dtSec * 1000)
      summary = await settleOfflineOnStores(now)
    } else {
      await advanceOnStores(ctx.dtSec, now, { exploration: true, suppress: true })
      useGameStore().stampActive(now)
    }
    rolloverDailyIfNeeded()
    checkStateAchievements()
    const patches = diffSlices(before, stateClone())
    const snapshot = snapshotFromActiveStores()
    return { patches, summary, snapshot }
  } catch {
    return null
  } finally {
    setActivePinia(undefined)
  }
}
