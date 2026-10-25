/** 今日天道:按日期种子确定性生成的每日挑战(刷新不换题),复用挑战书的验证与定价管线 */
import { mulberry32, RandomService } from '@/utils/random'
import { todayLocalNum } from '@/utils/time'
import { CELESTIAL_WORLDS } from '@/data/endgame'
import { MUTATORS } from '@/data/mutators'
import { PACTS } from '@/data/pacts'
import { verifyChallenge, undertakeChallenge, type ChallengeDraft, type ChallengeVerdict } from './challenge'
import { recordMilestone } from './identity'
import type { ExpeditionResult } from './endgameService'
import { useEndgameStore } from '@/stores/endgame'
import { useUiStore } from '@/stores/ui'

export interface DailyChallenge {
  day: number
  draft: ChallengeDraft
  verdict: ChallengeVerdict
}

/**
 * 今日的日号:本地日历,与洞府巡游/日课同口径(见 utils/time 注),跨本地午夜才换号。
 * 按 UTC 日计时,UTC+8 玩家本地 08:00 就翻到「明天」,同一本地日能领两份赏。
 */
export function todayNumber(): number {
  return todayLocalNum()
}

/**
 * 生成指定本地日的天道:日期种子确定性;裁判不受(无解/虚设)则顺延候选。
 *
 * `day` 可注入,供界面用响应式墙钟日号驱动题面:不传时才读当下本地日。
 */
export function todayChallenge(day = todayNumber()): DailyChallenge | null {
  for (let t = 0; t < 16; t += 1) {
    const rng = new RandomService(mulberry32(day * 131 + t * 977))
    const world = CELESTIAL_WORLDS[rng.int(0, CELESTIAL_WORLDS.length - 1)]!
    const pool = [...MUTATORS]
    const mutatorIds: string[] = []
    for (let i = 0; i < 2 && pool.length; i += 1) {
      mutatorIds.push(pool.splice(rng.int(0, pool.length - 1), 1)[0]!.id)
    }
    const pactId = rng.chance(0.35) ? PACTS[rng.int(0, PACTS.length - 1)]!.id : null
    const draft: ChallengeDraft = { worldId: world.id, mutatorIds, pactId, name: `今日天道` }
    const verdict = verifyChallenge(draft)
    if (verdict?.ok) return { day, draft, verdict }
  }
  return null
}

/** 应战今日天道:当日限领一次赏,失败可自费重试 */
export function undertakeDaily(daily: DailyChallenge): ExpeditionResult | null {
  const endgame = useEndgameStore()
  const ui = useUiStore()
  // 用「当下」本地日号判闸,不能信调用方传入的 daily.day —— daily 常来自非响应式的
  // todayChallenge()(Date.now() 不触发 computed 重算),玩家驻足跨过本地午夜时它仍是
  // 昨天那天的考题:若按传参判,清了「昨天」一天后 dailyDoneDay 一跳、daily 重算成今天,
  // 今天就再清一次 —— 同一会话连领两份天道赏。落闸只认当下日期。
  const day = todayLocalNum()
  if (endgame.dailyDoneDay === day) {
    ui.toast('今日天道已了,明日再会', 'info')
    return null
  }
  const result = undertakeChallenge(daily.draft, daily.verdict)
  if (result?.report.cleared) {
    endgame.markDailyDone(day)
    recordMilestone('first_daily')
  }
  return result
}
