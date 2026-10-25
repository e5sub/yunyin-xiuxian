/** 机缘链:机缘选择记忆,影响师承推荐;无新货币 */
import { usePlayerStore } from '@/stores/player'

export type FortuneChoice = 'take' | 'leave'

/** 机缘记忆:记一次选择 */
export function recordFortuneChoice(fortuneId: string, choice: FortuneChoice): void {
  const player = usePlayerStore()
  const next = { ...player.fortuneChoices, [fortuneId]: choice }
  player.setFortuneChoices(next)
}

/** 师承顺水:按机缘记忆推荐师承(人物页拜师时高亮) */
export function mentorHint(): 'swordsman' | 'alchemist' | 'arraymaster' | 'hunter' | null {
  const map: Record<string, 'swordsman' | 'alchemist' | 'arraymaster' | 'hunter'> = {
    ft_sword_remnant: 'swordsman',
    ft_ancient_elixir: 'alchemist',
    ft_blood_contract: 'arraymaster',
    ft_beast_pledge: 'hunter'
  }
  const choices = usePlayerStore().fortuneChoices
  for (const [fid, hint] of Object.entries(map)) {
    if (choices[fid] === 'take') return hint
  }
  return null
}
