/**
 * 道痕的道源额度(1.74.1) —— 一条通关道痕最多折多少道源。
 *
 * 为什么需要:道源(界外货币)的进项全在客户端结算 —— 远征破界、试炼、挑战书、天道变数
 * 判胜后 `endgame.addDaoSource(reward)`。服务端只看得见「道源多了」,而道源的持有上限按
 * 熔炉产出估(满产 720 小时),一次上传允许的增量只有上限的 5%:破一次界拿到的几百道源
 * 很容易越过这条线,超出部分被当改包压回 —— 与 1.74.0 灵石、1.74.1 分解尘同源。
 *
 * 这里给服务端一把尺:本次上传里**新增的通关道痕**各折多少道源额度。
 * 取的是实际结算公式的上界(契约最高倍率 × 速战最高加成 × 沿途节点 bonus 满取),
 * 不比真实收益小(不误伤),也不会凭空放大(额度只放宽上限,不往档里加钱)。
 *
 * 为什么放在 core 且能被 vendor:服务端 server/src/daoCredit 动态加载本模块复算,
 * 故这里只碰 data 层,不 import 任何带 store 的 core 模块。
 */
import { CELESTIAL_WORLDS, TRIALS } from '@/data/endgame'
import { PACTS } from '@/data/pacts'
import { slaughterSpeedBonus } from '@/core/daoDepth'
import type { CelestialWorldDef } from '@/types'

/** 天道契约的最高道源倍率:远征结算那一乘的封顶,取自契约表本身 */
const PACT_MULT_CEIL = Math.max(...PACTS.map(p => p.sourceMult))

/**
 * 速战之赏的上界:每战 0 回合(理论最快)时 slaughterSpeedBonus 给的那一档。
 * 直接问函数要,不手写 0.25 —— 档位调整后这里自动跟上。
 */
const SPEED_BONUS_CEIL = slaughterSpeedBonus(0, 1)

/**
 * 挑战书的道源上界:`core/challenge` 的 round(45 × (1.9 - best))。
 * 验价只在 best∈[0.15,0.97] 放行(≤79),这里按公式的理论上确界 86 取 —— 放宽阈值时不必再改。
 */
const CUSTOM_CHALLENGE_CEIL = 86

/**
 * 天道变数的道源:固定 55(`core/expedition` 的 MUTATION_BASE_REWARD),不吃契约倍率。
 * 同样不 import(expedition 连着世界生成与 store);数值由 daoCredit.spec 钉住。
 */
const MUTATION_CEIL = 55

/**
 * 一界的道源上界 = (界赏 + 沿途满取 bonus) × 契约最高倍率 × (1 + 速战上界)。
 * 沿途 bonus 逐层取两条路里大的那条:玩家确实可能挑最肥的路走。
 * 结算侧是 Math.floor,这里用 Math.ceil 保证额度不小于任何一次真实结算。
 */
function worldCeil(world: CelestialWorldDef): number {
  let routeBonus = 0
  for (const layer of world.routes) {
    let best = 0
    for (const node of layer) best = Math.max(best, node.bonus)
    routeBonus += best
  }
  return Math.ceil((world.rewardDaoSource + routeBonus) * PACT_MULT_CEIL * (1 + SPEED_BONUS_CEIL))
}

/**
 * 一条道痕的道源额度。认不出 targetId(改包塞的野 id)返回 0 —— 没有出处就不给额度。
 * `targetId` 就是 `recordMark` 落痕时的第一个参数:世界 id、试炼 id、'custom' 或 'mutation'。
 */
export function daoMarkCeil(targetId: string): number {
  if (typeof targetId !== 'string' || targetId === '') return 0
  const world = CELESTIAL_WORLDS.find(w => w.id === targetId)
  if (world !== undefined) return worldCeil(world)
  const trial = TRIALS.find(t => t.id === targetId)
  if (trial !== undefined) return trial.rewardDaoSource
  if (targetId === 'custom') return CUSTOM_CHALLENGE_CEIL
  if (targetId === 'mutation') return MUTATION_CEIL
  return 0
}
