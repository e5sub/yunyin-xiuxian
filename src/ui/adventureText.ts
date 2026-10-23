/**
 * 出发按钮上的账 —— 数字由 exploration 现算,这里只排成一行。
 * 行程、遇险、收益、遇敌间隔必须是结算即将用的那几个数。
 */
import { cnNumber, formatDuration } from '@/utils/format'
import { EXPLORE_MODES } from '@/data/constants'
import type { ExploreMode } from '@/types'
import type { PetPersonalityEffects } from '@/core/petPersonality'

/**
 * 每一档行程的凶险形容词 —— 纯展示层,与 `EXPLORE_MODES` 的数值无关。
 *
 * 单独一份映射而不是散在出行弹窗里:档位清单(`exploreModeIds`)从 `EXPLORE_MODES`
 * 的键派生,新增一档时按钮自动出现,这里缺的只是那一句形容词(回落「涉险」)。
 * 从前弹窗里手写一整张 `{ id, risk }` 清单 —— 加一档要改三处(表、类型、清单),
 * 漏改清单的那一档在界面上**根本不存在**,而结算认得它。
 */
export const EXPLORE_MODE_RISK_LABEL: Record<ExploreMode, string> = {
  normal: '安稳',
  deep: '小险',
  risky: '大凶',
  prolonged: '极险',
  marathon: '凶险',
  deepExpedition: '九死一生'
}

/** 未知档位(未来加档而这里还没写形容词)的回落 —— 不猜,只说它涉险 */
export const EXPLORE_MODE_RISK_FALLBACK = '涉险'

/** 某一档的凶险形容词;没登记的档位不静默留空 */
export function exploreModeRiskLabel(mode: ExploreMode): string {
  return EXPLORE_MODE_RISK_LABEL[mode] ?? EXPLORE_MODE_RISK_FALLBACK
}

/**
 * 全部行程档位,按 `EXPLORE_MODES` 的键序(即时长递进的顺序)。
 *
 * 界面不许再手写一份档位清单:表是唯一事实源,新增一档按钮自己长出来。
 */
export const exploreModeIds = Object.keys(EXPLORE_MODES) as ExploreMode[]

function timesLabel(n: number): string {
  const rounded = Math.round(n * 100) / 100
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0+$/, '')
  return text.endsWith('.') ? text.slice(0, -1) : text
}

export function departButtonText(p: {
  durationSec: number
  rewardMult: number
  dangerMult: number
  battleGapSec: number
}): string {
  return `行程 ${formatDuration(p.durationSec)} · 收益 ×${timesLabel(p.rewardMult)} · 遇险 ×${timesLabel(p.dangerMult)} · 遇敌约 ${formatDuration(p.battleGapSec)}`
}

/**
 * 出行那一刻,灵兽之性折进了什么 —— 与 dangerFactorFor / exploreDurationSec / loot
 * 读同一张 EFFECTS(同源):遇险与行程两个数给倍率,掉宝与护持只能定性(一个进品质
 * 权重、一个进败北判定,没有干净的单数可写)。无同伴返回空串。
 */
export function petTraitTripLine(petName: string, effects: PetPersonalityEffects): string {
  const parts: string[] = []
  if (effects.dangerMult !== 1) parts.push(`遇险 ×${timesLabel(effects.dangerMult)}`)
  if (effects.exploreDurMult !== 1) parts.push(`行程 ×${timesLabel(effects.exploreDurMult)}`)
  if (effects.dropLuck !== 0) parts.push(`掉宝${effects.dropLuck > 0 ? '更佳' : '稍逊'}`)
  if (effects.lossReduction > 0) parts.push('败北偶有护持')
  return parts.length > 0 ? `${petName}之性:${parts.join(' · ')}` : ''
}

/**
 * 行程档位的一行总账 —— 「N档行程 · 最凶较最稳凶 X 倍」。
 *
 * 两个数都从 `EXPLORE_MODES` 现算,加一档这句话自己跟上。
 * 从前这句话写在出行弹窗的 HTML 注释里(「三档里敌人差了 2.1 倍」):
 * 档位从四档扩到六档、最凶一档的凶险从 2.1 抬到 3.9 之后,它留在原处没动 ——
 * 而注释不渲染,玩家从来没看见过它,更没人会因为数字过时而报错。
 *
 * 抽成纯函数是为了让它**可被测**:源码文本断言只能证明「这一行插了值」,
 * 证不了插进去的是对的数(把 computed 改成返回 2.1、字面量原样留着,文本断言照样绿)。
 */
export function exploreModeSummaryLine(): string {
  const ids = exploreModeIds
  const dangers = ids.map(id => EXPLORE_MODES[id].dangerMult)
  const span = Math.round((Math.max(...dangers) / Math.min(...dangers)) * 10) / 10
  return `${cnNumber(ids.length)}档行程 · 最凶较最稳凶 ${span} 倍`
}

/**
 * 一趟历练的战绩 —— 胜 N 场、负 M 场。
 *
 * 只报胜场时,「胜 2 场」分不出是打了两场全胜,还是打了九场只赢了两场;
 * 而「胜 + 负 ≥ 3 才算走过一趟」的成就门槛、以及这趟值不值得再来,
 * 恰恰要的是**总量**。两本账本来就是会话里现成的 `wins` / `losses`,
 * 这里只负责把它们排成一行,不另算一遍。
 */
export function sessionRecordText(s: { wins: number; losses: number }): string {
  // Math.max(0, NaN) 仍是 NaN —— 先把非有限值按 0 收口,坏档才不会印出「胜 NaN 场」
  const count = (v: number): number => (Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0)
  const wins = count(s.wins)
  const losses = count(s.losses)
  return losses > 0 ? `胜 ${wins} 场 · 负 ${losses} 场` : `胜 ${wins} 场`
}
