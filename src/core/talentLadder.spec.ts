/* eslint-disable no-console -- 输出等阶对照表 */
/**
 * 天赋四等:稀有度的三条承诺。
 *   一 不被支配:更常见的天赋不得在每一项属性上都压住更稀有的;
 *   二 期望更强:各等平均复杂度预算单调递增(实测 0.54 · 0.86 · 0.90 · 2.18);
 *   三 各有领地:每一等至少一项属性为全池最高。
 * budgetOfMods 是机制复杂度会计,不是强度:条件类战斗词条算得重,运气与进阶率算得轻。
 * 天命、孤勇按预算看似越阶;按 budgetOfMods 重排天赋数据会改坏平衡。
 */
import { describe, expect, it } from 'vitest'
import { TALENTS } from '@/data/talents'
import { budgetOfMods } from './ruleBudget'

const GRADES = [1, 2, 3, 4] as const
const GRADE_NAME: Record<number, string> = { 1: '凡赋', 2: '灵赋', 3: '天赋', 4: '道赋' }

/** 稀有的 a 是否被更常见的 b 支配:每项都不高于 b,且至少一项更低 */
function dominatedBy(a: (typeof TALENTS)[number], b: (typeof TALENTS)[number]): boolean {
  if (b.grade >= a.grade) return false
  const keys = new Set([...Object.keys(a.mods), ...Object.keys(b.mods)])
  let strictlyWorse = false
  for (const k of keys) {
    const av = (a.mods as Record<string, number>)[k] ?? 0
    const bv = (b.mods as Record<string, number>)[k] ?? 0
    if (av > bv) return false
    if (av < bv) strictlyWorse = true
  }
  return strictlyWorse
}

/** 某一等的平均复杂度预算(不是强度) */
function avgBudget(grade: number): number {
  const list = TALENTS.filter(t => t.grade === grade).map(t => budgetOfMods(t.mods))
  return list.reduce((a, b) => a + b, 0) / list.length
}

/** 全池最高值落在该等的属性 */
function territoryOf(grade: number): string[] {
  const bestByStat = new Map<string, { grade: number; v: number }>()
  for (const t of TALENTS) {
    for (const [k, v] of Object.entries(t.mods)) {
      const cur = bestByStat.get(k)
      if (!cur || (v ?? 0) > cur.v) bestByStat.set(k, { grade: t.grade, v: v ?? 0 })
    }
  }
  return [...bestByStat.entries()].filter(([, x]) => x.grade === grade).map(([k]) => k)
}

describe('天赋四等 · 稀有度的三条承诺', () => {
  it('对照表:等阶 × 件数 × 均预算 × 属性领地', () => {
    console.log('\n—— 天赋四等(预算是复杂度会计,不是强度) ——')
    for (const g of GRADES) {
      const list = TALENTS.filter(t => t.grade === g)
      console.log(
        `  ${GRADE_NAME[g]}(权重 ${g === 1 ? 100 : g === 2 ? 45 : g === 3 ? 15 : 4}) n=${String(list.length).padStart(2)} ` +
          `均预算 ${avgBudget(g).toFixed(2)} · 领地:${territoryOf(g).join(' / ') || '(无)'}`
      )
    }
    expect(TALENTS.length).toBeGreaterThan(30)
  })

  it('① 不被支配:没有稀有位在每一个属性上都被常见位压住', () => {
    const bad: string[] = []
    for (const a of TALENTS) {
      for (const b of TALENTS) {
        if (a.id === b.id) continue
        if (dominatedBy(a, b)) {
          bad.push(`${a.name}(${GRADE_NAME[a.grade]}) 被更常见的 ${b.name}(${GRADE_NAME[b.grade]}) 全面压住`)
        }
      }
    }
    expect(bad, `这些天赋抽到就等于废牌:\n${bad.join('\n')}`).toEqual([])
  })

  it('② 期望更强:平均预算随等阶单调递增', () => {
    const avgs = GRADES.map(g => avgBudget(g))
    console.log(`\n  平均预算:${avgs.map((a, i) => `${GRADE_NAME[GRADES[i]!]} ${a.toFixed(2)}`).join(' < ')}`)
    for (let i = 1; i < avgs.length; i += 1) {
      expect(avgs[i], `${GRADE_NAME[GRADES[i]!]} 的均预算不高于 ${GRADE_NAME[GRADES[i - 1]!]}`).toBeGreaterThan(
        avgs[i - 1]!
      )
    }
  })

  it('③ 各有领地:每一等至少拥有一项全池最高的属性 —— 没有一等是填充物', () => {
    for (const g of GRADES) {
      expect(territoryOf(g).length, `${GRADE_NAME[g]} 没有任何属性上的领地 —— 这一等只是陪衬`).toBeGreaterThan(0)
    }
  })
})
