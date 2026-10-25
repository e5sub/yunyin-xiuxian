/** 悟道顿悟选项文案:数字与时长只从 buff 本体现算 */
import type { EnlightenmentOption } from '@/types'
import { buffDef } from '@/data/buffs'
import { formatChoiceSpan } from '@/utils/format'
import { modsText } from '@/data/statNames'

export function enlightenmentOptionText(opt: EnlightenmentOption): string {
  if (opt.reward?.type === 'wudao') return `悟道点 +${opt.reward.value}`
  if (opt.buffId) {
    const buff = buffDef(opt.buffId)
    if (buff) {
      const parts = [modsText(buff.mods), `持续 ${formatChoiceSpan(buff.durationSec)}`]
      return parts.join(',')
    }
  }
  return opt.desc
}
