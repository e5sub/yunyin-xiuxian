/**
 * 灵草五品:来源在哪一界,采到的就是哪一品;方子要什么品就用什么品。
 * 灵石购价在 `core/herbPrice.ts`(依赖 stoneByTier,数据层不依赖核心层)。
 * 唯一事实源:分档表 `HERB_GRADE_BANDS`,换算口 `herbGradeOfMajor`;业务代码不另抄境界→品阶的 if 链。
 */
import { MAX_MAJOR, REALMS, WORLD_BREAK_MAJOR } from './realms'

/** 灵草品阶:1 凡品 → 5 道品 */
export type HerbGrade = 1 | 2 | 3 | 4 | 5

export const HERB_GRADES: readonly HerbGrade[] = [1, 2, 3, 4, 5]

export const HERB_GRADE_NAMES: Record<HerbGrade, string> = {
  1: '凡品灵草',
  2: '灵品灵草',
  3: '仙品灵草',
  4: '神品灵草',
  5: '道品灵草'
}

export const HERB_GRADE_SHORT: Record<HerbGrade, string> = {
  1: '凡品',
  2: '灵品',
  3: '仙品',
  4: '神品',
  5: '道品'
}

export function isHerbGrade(v: unknown): v is HerbGrade {
  return v === 1 || v === 2 || v === 3 || v === 4 || v === 5
}

/**
 * 各品的灵田解锁等级(单调),每 3 级破一档,灵田满级(15)可种道品。只管等级上限:灵田升级不受境界门控,
 * 境界一侧由 fieldHerbGrade 的「限超前 +1」兜住(见 dongfu 注释)。
 */
const FIELD_GRADE_UNLOCK_LEVELS: Record<Exclude<HerbGrade, 1>, number> = { 2: 4, 3: 7, 4: 10, 5: 13 }

/** 灵田等级 → 可种最高品 */
export function fieldGradeCap(fieldLv: number): HerbGrade {
  let g: HerbGrade = 1
  for (const grade of [2, 3, 4, 5] as const) if (fieldLv >= FIELD_GRADE_UNLOCK_LEVELS[grade]) g = grade
  return g
}

/** 品阶与境界的分档表:[起始 major, 结束 major, 品阶];五档对齐四大界域,混沌海至高方子(混沌道祖 20)只认道品 */
export const HERB_GRADE_BANDS: ReadonlyArray<readonly [number, number, HerbGrade]> = [
  [0, 4, 1],
  [5, 8, 2],
  [WORLD_BREAK_MAJOR, 13, 3],
  [14, 17, 4],
  [18, MAX_MAJOR, 5]
]

/** 某品阶喂哪个境界的方子(坊市/方子说明用);由 HERB_GRADE_BANDS 反查,不另立分档表 */
export function herbGradeBandLabel(grade: HerbGrade): string {
  const band = HERB_GRADE_BANDS.find(b => b[2] === grade)
  if (!band) return ''
  const [from, to] = band
  const fromName = REALMS[from]?.name
  const toName = REALMS[to]?.name
  return fromName && toName ? `${fromName}~${toName}境方子所用` : `第 ${from}~${to} 境的方子所用`
}

/** 某大境界的灵草品阶(跨境即换品) */
export function herbGradeOfMajor(major: number): HerbGrade {
  const m = Math.max(0, Math.min(MAX_MAJOR, major))
  for (const [from, to, grade] of HERB_GRADE_BANDS) {
    if (m >= from && m <= to) return grade
  }
  return 1
}
