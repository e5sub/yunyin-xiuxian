/** 行军一指:把八门(奇门/择门)CombatRules 的生效字段派生为一行文案,与结算同源 */
import type { CombatRules } from '@/types'
import { formatPercent } from '@/utils/format'
import { modsText } from '@/data/statNames'

/** 倍率字段(m=1 即无改动)→ 攻势/气血/治疗 增贬 */
function multLine(parts: string[], m: number | undefined, label: string): void {
  if (m == null || m === 1) return
  const delta = m - 1
  // 正负号与 data/statNames 的 signedPercent 同一读法
  if (!Number.isFinite(delta)) return
  parts.push(`${label} ${delta < 0 ? '-' : '+'}${formatPercent(Math.abs(delta))}`)
}

/** 每 N 回合的周期增益 */
function perRoundsLine(p: NonNullable<CombatRules['perRounds']>): string {
  const seg = [`每 ${p.interval} 回合`]
  if (p.playerHealPct > 0) seg.push(`回 ${formatPercent(p.playerHealPct, 0)} 气血`)
  if (p.playerShieldPct > 0) seg.push(`护盾 ${formatPercent(p.playerShieldPct, 0)}`)
  if (p.enemyAtkGrowth > 0) seg.push(`敌方攻势 +${formatPercent(p.enemyAtkGrowth, 0)}`)
  return seg.join(' · ')
}

/** 行军数值串;无生效字段返回空串,调用方据此不渲染 */
export function gateRuleSummary(rules: CombatRules): string {
  const parts: string[] = []
  multLine(parts, rules.playerAtkMult, '攻势')
  multLine(parts, rules.enemyAtkMult, '敌方攻势')
  multLine(parts, rules.enemyHpMult, '敌方气血')
  multLine(parts, rules.healMult, '治疗')
  if (rules.shieldCapRatio != null && Number.isFinite(rules.shieldCapRatio)) {
    parts.push(`护盾上限 ${formatPercent(rules.shieldCapRatio, 0)}`)
  }
  if (rules.playerStartHpPct != null && Number.isFinite(rules.playerStartHpPct)) {
    parts.push(`以 ${formatPercent(rules.playerStartHpPct, 0)} 气血开战`)
  }
  if (rules.maxRounds != null && Number.isFinite(rules.maxRounds)) {
    parts.push(`回合上限 ${rules.maxRounds}`)
  }
  if (rules.playerExtraMods) {
    const t = modsText(rules.playerExtraMods)
    if (t) parts.push(`额外 ${t}`)
  }
  if (rules.enemyExtraMods) {
    const t = modsText(rules.enemyExtraMods)
    if (t) parts.push(`敌方额外 ${t}`)
  }
  if (rules.perRounds && Number.isFinite(rules.perRounds.interval)) {
    parts.push(perRoundsLine(rules.perRounds))
  }
  return parts.join(' · ')
}
