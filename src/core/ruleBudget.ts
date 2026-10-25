/** 规则预算:设计侧的复杂度会计,不是玩家资源;程序化生成与人工新增同一套账 */
import type { AnyStatKey, CombatRules, StatMods } from '@/types'
import { DIMINISH_KEYS } from '@/data/constants'

const DIMINISH_SET = new Set<string>(DIMINISH_KEYS)

/** 条件/触发词条按参考档归一后每单位 2 点,普通数值词条 1 点 */
const KEY_REFS: Partial<Record<AnyStatKey, number>> = {
  lowHpDamage: 0.6,
  lowHpReduction: 0.3,
  fullHpDamage: 0.36,
  firstStrike: 0.48,
  executeDamage: 0.3,
  shieldOnStart: 0.3,
  shieldPower: 0.3,
  overhealShield: 0.6,
  counterRate: 0.36,
  counterDamage: 0.9,
  comboRate: 0.33,
  comboDamage: 0.48,
  lifesteal: 0.09,
  regenPerRound: 0.024,
  stunRate: 0.09,
  critRate: 0.18,
  critDamage: 0.48,
  dodgeRate: 0.11,
  accuracy: 0.11,
  armorPen: 0.18,
  damageBonus: 0.18,
  damageReduction: 0.15,
  speed: 0.21,
  attackPct: 0.25,
  defensePct: 0.25,
  maxHpPct: 0.25
}

/** 词条组预算:Σ 权重 ×(数值 / 参考档) */
export function budgetOfMods(mods: StatMods | undefined): number {
  if (!mods) return 0
  let sum = 0
  for (const k in mods) {
    const key = k as AnyStatKey
    const v = Math.abs(mods[key] ?? 0)
    if (v === 0) continue
    const ref = KEY_REFS[key] ?? 0.25
    const weight = DIMINISH_SET.has(key) ? 2 : 1
    sum += (v / ref) * weight
  }
  return Math.round(sum * 10) / 10
}

/** 战斗规则预算:改变规则本身比加词条昂贵 */
export function budgetOfRules(rules: CombatRules | undefined): number {
  if (!rules) return 0
  let sum = 0
  if (rules.healMult !== undefined && rules.healMult !== 1) sum += 3
  if (rules.maxRounds !== undefined) sum += 3
  if (rules.shieldCapRatio !== undefined) sum += 3
  if (rules.enemyHpMult !== undefined && rules.enemyHpMult !== 1) sum += 2
  if (rules.enemyAtkMult !== undefined && rules.enemyAtkMult !== 1) sum += 2
  if (rules.playerAtkMult !== undefined && rules.playerAtkMult !== 1) sum += 2
  if (rules.playerStartHpPct !== undefined && rules.playerStartHpPct !== 1) sum += 3
  if (rules.perRounds) sum += 4
  sum += budgetOfMods(rules.playerExtraMods) + budgetOfMods(rules.enemyExtraMods)
  return Math.round(sum * 10) / 10
}

/** 单件内容预算上限(功法满配 / 法宝被动 / 天赋;现存最高 2.8) */
export const ITEM_BUDGET_CAP = 5
/** 单个世界规则预算上限(手工与程序化同账) */
export const WORLD_BUDGET_CAP = 14
