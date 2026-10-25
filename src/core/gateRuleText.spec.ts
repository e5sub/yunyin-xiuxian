/** 行军一指(gateRuleSummary):① 各门数值串正确;② 每个生效字段都落到文案 */
import { describe, expect, it } from 'vitest'
import { GATES } from '@/data/qimen'
import { gateRuleSummary } from './gateRuleText'

describe('行军一指 · 八门数值摊开', () => {
  it('按门对齐结算派生串(休/生/伤/杜)', () => {
    expect(gateRuleSummary(GATES.find(g => g.id === 'xiu')!.rules)).toBe(
      '每 3 回合 · 回 6% 气血 · 敌方攻势 +5%'
    )
    expect(gateRuleSummary(GATES.find(g => g.id === 'sheng')!.rules)).toBe('攻势 -5% · 治疗 +40%')
    expect(gateRuleSummary(GATES.find(g => g.id === 'shang')!.rules)).toBe(
      '攻势 +15% · 以 85% 气血开战'
    )
    expect(gateRuleSummary(GATES.find(g => g.id === 'du')!.rules)).toBe(
      '攻势 -10% · 敌方攻势 -10%'
    )
  })

  it('按门对齐结算派生串(景/死/惊/开)', () => {
    expect(gateRuleSummary(GATES.find(g => g.id === 'jing9')!.rules)).toBe(
      // 注脚来自 modsText,与别处同源
      '敌方气血 +8% · 额外 暴击率 +8%(叠于固有会心 5% 之上)'
    )
    expect(gateRuleSummary(GATES.find(g => g.id === 'si')!.rules)).toBe(
      '攻势 +25% · 敌方攻势 +20% · 敌方气血 +15% · 回合上限 20'
    )
    expect(gateRuleSummary(GATES.find(g => g.id === 'jing7')!.rules)).toBe(
      '攻势 +20% · 回合上限 15'
    )
    expect(gateRuleSummary(GATES.find(g => g.id === 'kai')!.rules)).toBe(
      '敌方攻势 -5% · 治疗 +25%'
    )
  })

  /** 闸门:CombatRules 新字段填进门里时,须在此补判定 */
  it('每个生效字段都要落到文案,不许漏藏数值', () => {
    for (const g of GATES) {
      const summary = gateRuleSummary(g.rules)
      expect(summary, `${g.fullName}没有任何数值说明`).not.toBe('')
      if (g.rules.playerAtkMult != null && g.rules.playerAtkMult !== 1) {
        expect(summary, `${g.fullName}漏了攻势`).toContain('攻势')
      }
      if (g.rules.enemyAtkMult != null && g.rules.enemyAtkMult !== 1) {
        expect(summary, `${g.fullName}漏了敌方攻势`).toContain('敌方攻势')
      }
      if (g.rules.enemyHpMult != null && g.rules.enemyHpMult !== 1) {
        expect(summary, `${g.fullName}漏了敌方气血`).toContain('敌方气血')
      }
      if (g.rules.healMult != null && g.rules.healMult !== 1) {
        expect(summary, `${g.fullName}漏了治疗`).toContain('治疗')
      }
      if (g.rules.playerStartHpPct != null) {
        expect(summary, `${g.fullName}漏了开场气血`).toContain('气血开战')
      }
      if (g.rules.maxRounds != null) {
        expect(summary, `${g.fullName}漏了回合上限`).toContain('回合上限')
      }
      if (g.rules.perRounds) {
        expect(summary, `${g.fullName}漏了周期增益`).toContain('回合')
      }
      if (g.rules.playerExtraMods) {
        expect(summary, `${g.fullName}漏了额外词条`).toContain('额外')
      }
    }
  })

  it('无生效字段返回空串(防御:不给空白凑一行)', () => {
    expect(gateRuleSummary({})).toBe('')
    expect(gateRuleSummary({ playerAtkMult: 1, healMult: 1 })).toBe('')
  })

  it('坏数不许吐出 NaN% / Infinity%(与 formatPercent 同一道兜底)', () => {
    expect(gateRuleSummary({ playerAtkMult: Number.NaN })).toBe('')
    expect(gateRuleSummary({ playerAtkMult: Number.POSITIVE_INFINITY })).toBe('')
    // 场次类字段同样不许 NaN
    expect(gateRuleSummary({ maxRounds: Number.NaN })).not.toContain('NaN')
  })
})
