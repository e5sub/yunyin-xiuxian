/** 道童归来文案:道童页与离线归来卷轴共用;只做展示,不改结算 */
import type { TaskSpoils } from '@/core/apprenticeService'
import { HERB_GRADE_NAMES, herbGradeOfMajor } from '@/data/herbGrades'
import { pillDef } from '@/data/pills'
import { formatGN } from '@/utils/format'

/** 灵草品名:道童采药与结算同一套品阶换算 */
export function apprenticeHerbName(major: number): string {
  return HERB_GRADE_NAMES[herbGradeOfMajor(major)]
}

/** 一趟产出的逐项文案;空产出返回空串 */
export function apprenticeSpoilsText(s: TaskSpoils, major: number): string {
  const parts: string[] = []
  if (s.herb) parts.push(`${apprenticeHerbName(major)}×${s.herb}`)
  if (s.ore) parts.push(`玄铁×${s.ore}`)
  if (s.dust) parts.push(`器灵尘×${s.dust}`)
  if (s.wudao) parts.push(`悟道×${s.wudao}`)
  if (s.stone) parts.push(`灵石 ${formatGN(s.stone)}`)
  if (s.pillId) parts.push(`${pillDef(s.pillId)?.name ?? '丹药'}×${s.pillCount ?? 1}`)
  return parts.join(' · ')
}

/** 一次收割的归来回执;没有道童完工时为空串 */
export function apprenticeReturnText(reaped: TaskSpoils[], major: number): string {
  if (reaped.length === 0) return ''
  if (reaped.length === 1) return `道童归来:${apprenticeSpoilsText(reaped[0]!, major)}`
  return `道童归来 ${reaped.length} 名:${reaped.map(s => apprenticeSpoilsText(s, major)).join(';')}`
}
