import { EQUIP_LEVEL_BONUS } from '@/data/constants'
import { formatPercent } from '@/utils/format'

/** Each level adds EQUIP_LEVEL_BONUS of the naked base; the gain relative to the stats on screen shrinks as the level rises */
export function equipNextLevelText(level: number): string {
  const rel = EQUIP_LEVEL_BONUS / (1 + level * EQUIP_LEVEL_BONUS)
  return `基础属性 +${formatPercent(rel)}`
}

/** 词条随机浮动,取实例上存的 roll(0~1) */
export function affixRollText(roll: number): string {
  return `浮 ${Math.round(Math.max(0, Math.min(1, roll)) * 100)}%`
}

/** 「浮 X%」的悬停说明 */
export const affixRollHint = '浮动:0% 下限 · 100% 上限'

/** 战斗价值对比行的命名;不叫「战力」,免得误认成面板的「战力」 */
export function powerCompareLabel(): string {
  return '战斗价值'
}
