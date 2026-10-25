/**
 * 灵草展示口径:五品不可互相换算,存量只逐品陈列,不报跨品之和(`resources.herb`)。
 * 坊市摆摊 / 炼丹弹窗 / 材料页共用。
 */
import { HERB_GRADES, HERB_GRADE_SHORT, type HerbGrade } from '@/data/herbGrades'

export interface HeldHerbGrade {
  grade: HerbGrade
  name: string
  count: number
}

/** 逐品列出持有 >0 的灵草,与坊市摆摊同款过滤 */
export function heldHerbGrades(herbOf: (g: HerbGrade) => number): HeldHerbGrade[] {
  return HERB_GRADES.filter(g => herbOf(g) > 0).map(g => ({
    grade: g,
    name: HERB_GRADE_SHORT[g],
    count: herbOf(g)
  }))
}

/** 灵草存量文案;count 走 fmt,防大数撑破格子 */
export function herbStashText(herbOf: (g: HerbGrade) => number, fmt: (n: number) => string = String): string {
  const held = heldHerbGrades(herbOf)
  if (!held.length) return '无'
  return held.map(h => `${h.name}×${fmt(h.count)}`).join(' · ')
}
