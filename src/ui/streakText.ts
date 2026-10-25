/** Win-streak payout line. Numbers come from the reward row that was just granted. */
import { formatNum } from '@/utils/format'

export function streakRewardText(streak: number, stone: number, wudao: number): string {
  const parts = [`连胜 ${streak} 场`]
  if (stone > 0) parts.push(`灵石 +${formatNum(stone)}`)
  if (wudao > 0) parts.push(`悟道点 +${formatNum(wudao)}`)
  return parts.join(' · ')
}
