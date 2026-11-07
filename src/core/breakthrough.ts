/** 突破编排:门槛提示 / 服务端权威结算 / 簿记与展示。判据本体在 core/breakthroughResolve。 */
import { formatYears } from '@/utils/format'
import { worldOf, isWorldEntry } from '@/data/realms'
import { track, trackRealm, checkStateAchievements } from './progress'
import { recordMilestone } from './identity'
import { worldLeap } from '@/ui/worldMark'
import { usePlayerStore } from '@/stores/player'
import { useResourcesStore } from '@/stores/resources'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import type { BreakthroughView } from '@/stores/ui'
import { playSfx } from './audio'
import { SAVE_SANITIZE_STEPS } from './saveSanitize'
import { cloudApi, CloudError } from '@/services/cloud'
import { breakthroughInfo, resolveBreakthroughOnStores, type BreakthroughOutcome } from './breakthroughResolve'

export { breakthroughInfo, tribulationSuccessRate } from './breakthroughResolve'
export type { BreakthroughInfo, RatePart } from './breakthroughResolve'

/** 把服务端回传的变更字段落进本地 store(键集只含被结算改动的顶层字段) */
function applySlices(slices: Record<string, unknown> | undefined): void {
  if (slices === undefined || slices === null) return
  for (const [slice, fields] of Object.entries(slices)) {
    if (fields === null || typeof fields !== 'object') continue
    const step = SAVE_SANITIZE_STEPS.find(s => s.slice === slice)
    if (step === undefined) continue
    const store = step.use() as unknown as { $patch: (partial: Record<string, unknown>) => void }
    store.$patch(fields as Record<string, unknown>)
  }
}

/** 尝试突破,返回展示数据(由 UI 弹窗呈现)。
 *  登录玩家:掷点与渡劫只在服务端结算,本地只按回传字段落账 —— 改 store 改不动天命;
 *  未登录(离线单机):无服务端可裁,走同一条本地结算链,联网后由上传权威化收口。 */
export async function attemptBreakthrough(): Promise<BreakthroughView | null> {
  const player = usePlayerStore()
  const ui = useUiStore()
  const auth = useAuthStore()
  const info = breakthroughInfo()
  if (!info.ready) {
    ui.toast(info.reason, 'warn')
    return null
  }
  const fromLabel = player.realmName

  let outcome: BreakthroughOutcome
  if (auth.loggedIn) {
    try {
      const res = await cloudApi.resolveBreakthrough({ exp: player.exp, qi: useResourcesStore().qi })
      if (!res.ok || res.outcome === undefined || res.outcome === null) {
        ui.toast(res.reason ?? '突破未能结算', 'warn')
        return null
      }
      outcome = res.outcome
      // 服务端改过的字段(境界/修为/灵气/伤势/突破准备)当场落进本地
      applySlices(res.slices)
    } catch (e) {
      ui.toast(e instanceof CloudError ? e.message : '突破结算失败', 'warn')
      return null
    }
  } else {
    outcome = resolveBreakthroughOnStores()
    if (!outcome.ok) {
      ui.toast(outcome.reason, 'warn')
      return null
    }
  }

  let view: BreakthroughView
  if (outcome.success) {
    track('breakthroughs')
    trackRealm()
    checkStateAchievements()
    // 失败不计数,否则连败三次即解锁 a_trib3
    if (outcome.needTribulation) track('tribulations')
    playSfx('breakthrough')
    const realm = player.realm
    // 跨界飞升三步(入仙界/神界/混沌海)给独立叙事与跨世节点,人间界入口不算
    const crossedWorld = outcome.isMajor && player.major > 0 && isWorldEntry(player.major)
    const world = crossedWorld ? worldOf(player.major) : null
    // 跨界的那一跃:离开哪一界、进入哪一界、寿元翻几倍(只认跨界入口,不认同界域的大关)
    const leap = crossedWorld ? worldLeap(player.major) : undefined
    if (world) recordMilestone(`first_${world.id}`)
    const baseMessage = `${realm.desc}。寿元增至 ${formatYears(player.lifespanMax)}。`
    // 大关进阶附这一境的出处
    const loreLine = `——「${realm.basis}」${realm.lore}`
    view = {
      success: true,
      fromLabel,
      toLabel: player.realmName,
      isMajor: outcome.isMajor,
      tribulationLog: outcome.tribulationLog,
      // 小进阶不附言:成败与境界去向弹窗已写明
      message: !outcome.isMajor
        ? ''
        : world
          ? `已入${world.name}。${world.desc}。${baseMessage}${loreLine}`
          : `${baseMessage}${loreLine}`,
      // 文本里那句「已入仙界」是文学;倍数才是分量,单独给弹窗画
      ...(leap ? { leap } : {})
    }
  } else {
    track('breakthroughFails')
    playSfx('fail')
    view = {
      success: false,
      fromLabel,
      toLabel: info.targetLabel,
      isMajor: outcome.isMajor,
      tribulationLog: outcome.tribulationLog,
      // 渡劫败局伤势已在劫报末行;小进阶无劫报,附一句状态
      message: outcome.needTribulation ? '' : '重伤'
    }
  }
  ui.breakthrough = view
  return view
}
