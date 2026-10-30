/**
 * VIP 托管自动化:自动打 BOSS / 自动闭关 / 自动历练。
 * 只在页面存活时跑(App.vue 启停);历练与闭关互斥,自动历练优先,自动闭关仅在未开自动历练时接管。
 * 开关存 settings(持久化),但一律须 VIP;VIP 到期由本循环复核后自动关停并提示。
 */
import { cloudApi, type BossStrikeResult } from '@/services/cloud'
import { useAuthStore } from '@/stores/auth'
import { useGameStore } from '@/stores/game'
import { useSettingsStore } from '@/stores/settings'
import { useAdventureStore } from '@/stores/adventure'
import { usePlayerStore } from '@/stores/player'
import { useResourcesStore } from '@/stores/resources'
import { useUiStore } from '@/stores/ui'
import { useEndgameStore } from '@/stores/endgame'
import { isRetreating, startRetreat } from './earlyGameService'
import { startExploration } from './exploration'
import { canEnterRegion } from './mortalWorldService'
import { endgameBusy } from './endgameActivity'
import { stoneByTier } from './formulas'
import { tierOfMajor } from './secretRealm'

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
    const regionId = g.settings.autoRegionId
    // 目标未选或已进不去(妖气复聚/转世重置):不开,等玩家在设置里重选;不打扰
    if (regionId === '' || !canEnterRegion(regionId)) return
    if (startExploration(regionId, g.settings.autoMode)) {
      useUiStore().toast('托管:已自动出行历练', 'info')
    }
    return
  }

  if (g.settings.autoRetreat && startRetreat()) {
    useUiStore().toast('托管:已自动闭关', 'info')
  }
}

/** 自动打 BOSS:妖王存活且今日还有出剑次数时出剑 */
async function tickBoss(): Promise<void> {
  const g = gate()
  if (g === null || !g.settings.autoBoss) return
  try {
    const st = await cloudApi.boss()
    if (!st.alive || st.myAttempts >= st.maxAttempts) return
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
}

/** 供测试与设置页复核:重置到期提示位 */
export function resetAutoOpsExpiryNotice(): void {
  expiryNotified = false
}
