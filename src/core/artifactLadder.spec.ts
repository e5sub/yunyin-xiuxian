/* eslint-disable no-console -- 品阶阶梯表给人复核 */
/**
 * 法宝品阶阶梯:同一效果族内按 (fromTier, 品阶) 排序后,玩家看到的数值与被动预算都不许回落。
 * 承诺见 data/artifacts 头部。
 */
import { describe, expect, it } from 'vitest'
import { ARTIFACTS, artifactValue } from '@/data/artifacts'
import { qualityDef } from '@/data/qualities'
import { budgetOfMods } from './ruleBudget'
import type { ArtifactDef } from '@/types'

/** 被动预算容差,比取整粒度 0.1 宽得多:被动按身份设计,族内横比不是同一量纲,只拦半档以上的回落 */
const BUDGET_EPS = 0.5
/** 数值舍入容差:品阶倍率最后一位的舍入 */
const AMOUNT_EPS = 0.002

interface Row {
  def: ArtifactDef
  amount: number
  budget: number
  qualityRank: number
}

/** 同一效果族的阶梯(按 fromTier → 品阶排序) */
function ladders(): Map<string, Row[]> {
  const byType = new Map<string, ArtifactDef[]>()
  for (const def of ARTIFACTS) {
    const type = def.active.effect.type
    byType.set(type, [...(byType.get(type) ?? []), def])
  }
  const out = new Map<string, Row[]>()
  for (const [type, defs] of byType) {
    const rows = defs
      .map(def => {
        const v = artifactValue(def, 0)
        return { def, amount: v.active.amount, budget: budgetOfMods(v.passive), qualityRank: qualityDef(def.quality).rank }
      })
      .sort((a, b) => a.def.fromTier - b.def.fromTier || a.qualityRank - b.qualityRank)
    out.set(type, rows)
  }
  return out
}

describe('法宝品阶阶梯', () => {
  it('打印各族阶梯(数值口径:凡品零重 × 品阶) ', () => {
    console.log('\n—— 法宝阶梯(效果数值 / 被动预算;按层级→品阶排序) ——')
    for (const [type, rows] of ladders()) {
      console.log(`  ${type}:`)
      for (const r of rows) {
        console.log(
          `    t${String(r.def.fromTier).padStart(2)} ${qualityDef(r.def.quality).name} ` +
            `${r.def.name.padEnd(6)} 数值 ${r.amount.toFixed(3).padStart(6)} · 被动预算 ${r.budget.toFixed(1)}`
        )
      }
    }
    expect(ARTIFACTS.length).toBeGreaterThan(40)
  })

  it('同一效果族内,效果数值不随层级/品阶回落', () => {
    for (const [type, rows] of ladders()) {
      // 震慑没有数值,只守被动预算那条
      if (type === 'stun') continue
      for (let i = 1; i < rows.length; i += 1) {
        const prev = rows[i - 1]!
        const cur = rows[i]!
        expect(
          cur.amount,
          `${cur.def.name}(t${cur.def.fromTier} ${qualityDef(cur.def.quality).name}) 的数值 ${cur.amount.toFixed(3)} ` +
            `低于更浅/更低的 ${prev.def.name}(t${prev.def.fromTier} ${qualityDef(prev.def.quality).name}) ${prev.amount.toFixed(3)}`
        ).toBeGreaterThanOrEqual(prev.amount - AMOUNT_EPS)
      }
    }
  })

  it('同一效果族内,被动预算不随层级/品阶回落', () => {
    for (const rows of ladders().values()) {
      for (let i = 1; i < rows.length; i += 1) {
        const prev = rows[i - 1]!
        const cur = rows[i]!
        expect(
          cur.budget,
          `${cur.def.name}(t${cur.def.fromTier} ${qualityDef(cur.def.quality).name}) 的被动预算 ${cur.budget.toFixed(1)} ` +
            `低于更浅/更低的 ${prev.def.name}(t${prev.def.fromTier} ${qualityDef(prev.def.quality).name}) ${prev.budget.toFixed(1)}`
        ).toBeGreaterThanOrEqual(prev.budget - BUDGET_EPS)
      }
    }
  })

  /** 上限 5,与 `ruleUniverse.spec` 的单件预算上限同源 */
  it('抬完阶梯仍在单件预算上限之内', () => {
    for (const def of ARTIFACTS) {
      const b = budgetOfMods(artifactValue(def, 0).passive)
      expect(b, `${def.name} 被动预算 ${b}`).toBeLessThan(5)
    }
  })
})
