/**
 * VIP 托管自动化:自动打 BOSS / 自动闭关 / 自动历练。
 * 在线时本循环驱动(App.vue 启停);历练与闭关都开时历练优先。
 * 离线时服务端按同步上来的设置代打妖王(所得记台账,归来领取);
 * 闭关/历练的离线收益在归来结算时补推(见 prepOfflineAutoOps)。
 * 开关存 settings(持久化)并同步服务端,一律须 VIP;到期自动关停并提示。
 */
import { watch } from 'vue'
import type { EnemyDef, ExploreMode, RegionDef } from '@/types'
import { cloudApi, type BossStrikeResult } from '@/services/cloud'
import { useAuthStore } from '@/stores/auth'
import { useGameStore } from '@/stores/game'
import { useSettingsStore } from '@/stores/settings'
import { useAdventureStore } from '@/stores/adventure'
import { usePlayerStore } from '@/stores/player'
import { useResourcesStore } from '@/stores/resources'
import { useUiStore } from '@/stores/ui'
import { useEndgameStore } from '@/stores/endgame'
import { useCultivationStore } from '@/stores/cultivation'
import { isRetreating, startRetreat } from './earlyGameService'
import { canEnterRegion, placeContent } from './mortalWorldService'
import { endgameBusy } from './endgameActivity'
import { stoneByTier } from './formulas'
import { tierOfMajor } from './secretRealm'
import { AUTO_REGION_ID, EXPLORE_MODES } from '@/data/constants'
import { REGIONS, regionDef } from '@/data/regions'
import { enemyDef } from '@/data/enemies'
import { makeEnemySnap, sampleWinRate } from './combat'
import { buildPlayerSnap } from './playerSnap'
import { personalityEffects } from './petPersonality'
import { dangerFactorFor, explorationRules, regionBossCleared, startExploration } from './exploration'
import { pickAutoPlan, type AutoAdventurePlan } from './autoAdventure'
import { autoTripText } from '@/ui/adventureText'
import { RandomService, mulberry32 } from '@/utils/random'
import { gnZero } from '@/utils/gnum'
import { formatGN } from '@/utils/format'

/** 历练/闭关巡检周期:会话时长以分钟计,10 秒粒度足够 */
const MAIN_TICK_MS = 10_000
/** BOSS 巡检周期:出剑次数每日有限,1 分钟一查不会给服务端添负担 */
const BOSS_TICK_MS = 60_000

let mainTimer: ReturnType<typeof setInterval> | undefined
let bossTimer: ReturnType<typeof setInterval> | undefined
/** 到期提示只报一次:置位后不再重复 toast,直到重新成为 VIP */
let expiryNotified = false

function stopAllToggles(): void {
  const settings = useSettingsStore()
  settings.autoBoss = false
  settings.autoRetreat = false
  settings.autoAdventure = false
}

/** 通用前置:游戏已开局、已登录、有任一托管开关;返回 null 表示本次 tick 无事可做 */
function gate(): { auth: ReturnType<typeof useAuthStore>; settings: ReturnType<typeof useSettingsStore> } | null {
  const game = useGameStore()
  const auth = useAuthStore()
  const settings = useSettingsStore()
  if (!game.started || !auth.loggedIn) return null
  if (!settings.autoBoss && !settings.autoRetreat && !settings.autoAdventure) return null
  if (!auth.isVip) {
    if (!expiryNotified) {
      expiryNotified = true
      stopAllToggles()
      useUiStore().toast('VIP 已到期,托管已停止', 'warn')
    }
    return null
  }
  expiryNotified = false
  return { auth, settings }
}

/* ---------------- 择地:托管这一趟去哪一处 ---------------- */

/** 这一趟的去处:自动择地给出 plan,手动指定则为 null(回执文案分两种口径) */
export interface TripTarget {
  regionId: string
  regionName: string
  mode: ExploreMode
  plan: AutoAdventurePlan | null
}

/** 试打用的定种随机源:同一地同一档总给同一个结果,免得每 10 秒翻一次脸 */
function stableRng(key: string): RandomService {
  let h = 2166136261
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return new RandomService(mulberry32(h >>> 0))
}

/**
 * 某地某档的遇敌胜率:取本世节点里最凶的一只,按实战同一套规则与危险因子试打三场。
 * 与离线收益估算同用 `sampleWinRate`(见 core/offline),两处口径不分叉。
 * 区域事件不入估算:它是几个时辰里的临时加难,拿它择地会让托管随妖潮来回跳。
 */
function estimateWinRate(region: RegionDef, mode: ExploreMode): number {
  const player = usePlayerStore()
  const mobs = placeContent(region.id).enemies.map(enemyDef).filter((d): d is EnemyDef => d !== undefined)
  if (mobs.length === 0) return 0
  const danger = dangerFactorFor(
    EXPLORE_MODES[mode].dangerMult,
    region.danger,
    personalityEffects(player.petId).dangerMult,
    1
  )
  const snap = buildPlayerSnap()
  const rng = stableRng(`${region.id}|${mode}`)
  let worst = 1
  for (const mob of mobs) {
    // 取最凶的一只作准:过了最凶的,其余自然过得去
    worst = Math.min(worst, sampleWinRate(snap, makeEnemySnap(mob, region.tier, danger), rng, 3, explorationRules()))
  }
  return worst
}

/** 此刻可去的候选地界,按层级由深到浅(择地取「最深且站得住」靠这个序) */
function adventureCandidates(): RegionDef[] {
  const player = usePlayerStore()
  return REGIONS.filter(
    r => r.minRealm <= player.major && canEnterRegion(r.id) && placeContent(r.id).enemies.length > 0
  ).sort((a, b) => b.tier - a.tier)
}

/** 自动择地:挑最深且打得过的一处(力有不及则退档,再不行不出行) */
export function planAutoAdventure(preferred: ExploreMode): AutoAdventurePlan | null {
  return pickAutoPlan(adventureCandidates(), preferred, { rateAt: estimateWinRate, cleared: regionBossCleared })
}

/**
 * 这一趟该去哪:自动择地走择地结果,手动指定则照玩家所选(没选/进不去则不出行)。
 * 在线巡检与离线补推共用这一处,两处不各写一套。
 */
export function autoTripTarget(regionId: string, mode: ExploreMode): TripTarget | null {
  if (regionId === AUTO_REGION_ID) {
    const plan = planAutoAdventure(mode)
    if (plan === null) return null
    return { regionId: plan.regionId, regionName: plan.regionName, mode: plan.mode, plan }
  }
  if (regionId === '' || !canEnterRegion(regionId)) return null
  const region = regionDef(regionId)
  if (region === undefined) return null
  return { regionId, regionName: region.name, mode, plan: null }
}

/** 自动历练与自动闭关(互斥,历练优先) */
function tickMain(): void {
  const g = gate()
  if (g === null) return
  const adventure = useAdventureStore()
  const player = usePlayerStore()
  if (player.dead || player.secretRealm) return
  if (adventure.session || isRetreating()) return
  const busy = endgameBusy(useEndgameStore().worldRun, null, null)
  if (busy) return

  if (g.settings.autoAdventure) {
    const target = autoTripTarget(g.settings.autoRegionId, g.settings.autoMode)
    // 无处可去(未选去处 / 力有不及):不出行,等玩家改设置或提升修为;不打扰
    if (target === null) return
    // 只有换了地或换了档才报一条,免得每 10 秒重开行程都刷屏
    const turned = target.regionId !== lastTrip.regionId || target.mode !== lastTrip.mode
    if (startExploration(target.regionId, target.mode, { quiet: true })) {
      if (turned) useUiStore().toast(autoTripText(target), 'info')
      lastTrip = { regionId: target.regionId, mode: target.mode }
    }
    return
  }

  if (g.settings.autoRetreat && startRetreat()) {
    useUiStore().toast('托管:已自动闭关', 'info')
  }
}

/** 上一趟的去处:换地换档才报回执 */
let lastTrip: { regionId: string; mode: ExploreMode } = { regionId: '', mode: 'normal' }

/** 上一轮「蓄势」提示对应的原因:同一原因只报一次,免得每分钟刷一条 */
let lastHoldReason = ''

/**
 * 自动打 BOSS:按服务端预判决定出剑——
 * 能补刀先补刀(三倍),站得住就砍;明显打不过则蓄势留剑,次数不过期(临期服务端会兜底出手)。
 */
async function tickBoss(): Promise<void> {
  const g = gate()
  if (g === null || !g.settings.autoBoss) return
  try {
    const st = await cloudApi.boss()
    if (!st.alive || st.myAttempts >= st.maxAttempts) return
    if (st.assess !== undefined && !st.assess.worthIt) {
      if (st.assess.reason !== lastHoldReason) {
        lastHoldReason = st.assess.reason
        if (st.assess.reason === 'hold') {
          useUiStore().toast('托管:蓄势留剑,待其力竭', 'info')
        }
      }
      return
    }
    lastHoldReason = ''
    const r: BossStrikeResult = await cloudApi.bossStrike()
    // 奖励即时入账(与 BossView 手动出剑同一条入账路径)
    const resources = useResourcesStore()
    resources.addStone(stoneByTier(tierOfMajor(Math.max(0, r.tier)), r.reward.stone))
    resources.addSmall('herb', r.reward.herb)
    if (r.killed) useUiStore().toast(`托管:出剑讨伐,${r.bossName}已陨落!`, 'success')
  } catch {
    // 云不可达 / 次数用尽 / 会话失效等:静默跳过,下一轮再说
  }
}

export function startAutoOps(): void {
  if (mainTimer !== undefined) return
  mainTimer = setInterval(tickMain, MAIN_TICK_MS)
  bossTimer = setInterval(() => void tickBoss(), BOSS_TICK_MS)
  // 托管设置变更(含登录成为 VIP、到期自动关停)即同步服务端:离线托管按这份设置代打
  stopSyncWatch = watch(
    () => {
      const auth = useAuthStore()
      const s = useSettingsStore()
      return [auth.loggedIn, auth.isVip, s.autoBoss, s.autoRetreat, s.autoAdventure, s.autoRegionId, s.autoMode] as const
    },
    () => scheduleSync(),
    { immediate: true }
  )
}

export function stopAutoOps(): void {
  if (mainTimer !== undefined) {
    clearInterval(mainTimer)
    mainTimer = undefined
  }
  if (bossTimer !== undefined) {
    clearInterval(bossTimer)
    bossTimer = undefined
  }
  if (stopSyncWatch !== undefined) {
    stopSyncWatch()
    stopSyncWatch = undefined
  }
  if (syncTimer !== undefined) {
    clearTimeout(syncTimer)
    syncTimer = undefined
  }
}

/* ---------------- 离线托管 ---------------- */

/** 托管设置同步的防抖计时器与 watcher 句柄 */
let syncTimer: ReturnType<typeof setTimeout> | undefined
let stopSyncWatch: (() => void) | undefined

function pushAutoOpsSettings(): void {
  const auth = useAuthStore()
  const settings = useSettingsStore()
  if (!auth.loggedIn || !auth.isVip) return
  void cloudApi
    .putVipAutoOps({
      autoBoss: settings.autoBoss,
      autoRetreat: settings.autoRetreat,
      autoAdventure: settings.autoAdventure,
      regionId: settings.autoRegionId,
      mode: settings.autoMode
    })
    .catch(() => undefined)
}

function scheduleSync(): void {
  if (syncTimer !== undefined) clearTimeout(syncTimer)
  syncTimer = setTimeout(pushAutoOpsSettings, 2000)
}

/** 服务端托管的设置(开局前取一次;网络不通时退回本机设置) */
let syncedAutoOps: { autoBoss: boolean; autoRetreat: boolean; autoAdventure: boolean; regionId: string; mode: string } | null = null

/**
 * 归来补推:开局前调用(先于离线结算)。
 * 离线期间的自动历练/闭关,靠把历练会话/闭关 buff 补到覆盖整个离线窗口,
 * 让 settleOffline 用同一套离线公式结出整段收益;历练优先,与在线同规。
 */
export async function prepOfflineAutoOps(): Promise<void> {
  const auth = useAuthStore()
  if (!auth.loggedIn) return
  try {
    syncedAutoOps = (await cloudApi.vipAutoOps()).settings
  } catch {
    syncedAutoOps = null
  }
  const game = useGameStore()
  if (!game.started || game.lastActiveAt <= 0) return
  if (!auth.isVip) return
  const settings = useSettingsStore()
  const wantAdventure = syncedAutoOps !== null ? syncedAutoOps.autoAdventure : settings.autoAdventure
  const wantRetreat = syncedAutoOps !== null ? syncedAutoOps.autoRetreat : settings.autoRetreat
  if (!wantAdventure && !wantRetreat) return
  const player = usePlayerStore()
  if (player.dead || player.secretRealm) return
  const adventure = useAdventureStore()
  if (endgameBusy(useEndgameStore().worldRun, null, null)) return
  const offlineSec = Math.max(0, (Date.now() - game.lastActiveAt) / 1000)
  if (offlineSec < 60) return // 窗口太短,不值得补推

  if (wantAdventure) {
    // 在途行程:托管让它一路走到归来,整段离线按同一行程结算(而不是只结到原定收队时刻)
    const ongoing = adventure.session
    if (ongoing !== null) {
      if (ongoing.endsAt < Date.now()) ongoing.endsAt = Date.now()
      return
    }
    if (isRetreating()) return
    const regionId = syncedAutoOps !== null ? syncedAutoOps.regionId : settings.autoRegionId
    const rawMode = syncedAutoOps !== null ? syncedAutoOps.mode : settings.autoMode
    const mode = (rawMode in EXPLORE_MODES ? rawMode : settings.autoMode) as keyof typeof EXPLORE_MODES
    // 与在线 tick 同一条择地口径:自动择地此刻按归来时的修为重挑一处(离线整段都在这处结算)
    const target = autoTripTarget(regionId, mode)
    if (target === null) return
    const start = Date.now() - offlineSec * 1000
    adventure.setSession({
      regionId: target.regionId,
      mode: target.mode,
      startedAt: start,
      endsAt: Date.now(),
      nextBattleAt: start,
      wins: 0,
      losses: 0,
      events: 0,
      stoneGain: gnZero(),
      expGain: gnZero(),
      itemGain: 0
    })
    return
  }
  if (adventure.session !== null) return
  if (isRetreating()) return

  // 自动闭关:闭关 buff 补活到离线结算那一刻(整段按 +150% 修速结算,归来即刻自然到期)
  const cult = useCultivationStore()
  const inst = cult.buffs.find(b => b.defId === 'retreat')
  if (inst !== undefined) inst.endsAt = Date.now() + 1000
  else cult.addBuff('retreat', Date.now())
}

/** 离线讨伐所得领取失败的重试次数上限 */
const COLLECT_MAX_RETRIES = 5
let collectRetries = 0

/** 领取离线讨伐所得:与在线出剑同一条入账路径(按妖王境界折灵石),领后报一笔总账 */
export async function collectOfflineBossLedger(): Promise<void> {
  const auth = useAuthStore()
  if (!auth.loggedIn || !auth.isVip) return
  try {
    const c = (await cloudApi.collectVipAutoOps()).collected
    collectRetries = 0
    if (c.strikes <= 0) return
    const resources = useResourcesStore()
    const stone = stoneByTier(tierOfMajor(Math.max(0, c.tier)), c.stoneM)
    resources.addStone(stone)
    resources.addSmall('herb', c.herb)
    useUiStore().toast(`托管离线讨伐:出剑 ${c.strikes} 次 · 灵石 +${formatGN(stone)}`, 'success')
  } catch {
    // 网络抖动:稍候重试,次数用尽则等下次登录再领(台账在服务端不清零)
    if (collectRetries < COLLECT_MAX_RETRIES) {
      collectRetries += 1
      setTimeout(() => void collectOfflineBossLedger(), 30_000)
    }
  }
}
