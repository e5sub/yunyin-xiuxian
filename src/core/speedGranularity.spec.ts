/**
 * 先手是阈值判定(1 + 修正 ≥ 对手速度即抢先,见 core/combat.ts),敌人速度按 5% 一档。
 * 故障注入:把迅捷改成 3–6,或给某件装备写 speed: 0.03,本用例红。
 */
import { describe, expect, it } from 'vitest'
import { AFFIXES } from '@/data/affixes'
import { ARTIFACTS } from '@/data/artifacts'
import { BUFFS } from '@/data/buffs'
import { ENEMIES } from '@/data/enemies'
import { EQUIPMENT_TEMPLATES } from '@/data/equipment'
import { GONGFA } from '@/data/gongfa'
import { GONGFA_BRANCHES } from '@/data/gongfaBranches'
import { PETS } from '@/data/pets'
import { TALENTS } from '@/data/talents'
import { TITLES } from '@/data/titles'

/** 敌人速度步长(data/enemies 的 mults[3] 只按它取档) */
const STEP = 0.05

describe('先手判定 · 每一处来源都得跨得过一档', () => {
  it('地基:敌人速度确实一档一档地给', () => {
    const speeds = ENEMIES.map(e => e.speed)
    const bands = new Set(speeds.map(s => Math.round(s / STEP)))
    expect(bands.size, '敌人速度只有一两档 —— 阈值判据就失去意义了').toBeGreaterThan(4)
    const offStep = [...new Set(speeds.filter(s => Math.abs(s / STEP - Math.round(s / STEP)) > 1e-9))]
    expect(offStep, `这些速度不在 ${STEP} 的档上,本判据的分档前提要跟着改`).toEqual([])
  })

  it('词条:最低一掷也要跨过一档', () => {
    const bad = AFFIXES.filter(a => a.key === 'speed' && a.min / 100 < STEP - 1e-9).map(
      a => `${a.name} 最低 ${a.min}%(低于一档)`
    )
    expect(bad, `先手判定词条的最低值跨不过任何一档,那一掷就是白掷:\n${bad.join('\n')}`).toEqual([])
  })

  it('装备固有:低于一档的 speed 是死数值', () => {
    const bad = EQUIPMENT_TEMPLATES.filter(t => {
      const v = t.fixedMods?.speed
      return v !== undefined && v > 0 && v < STEP - 1e-9
    }).map(t => `${t.name}(${t.tier} 阶) speed=${t.fixedMods!.speed}`)
    expect(bad, `这些装备写着先手加成,却跨不过任何一档:\n${bad.join('\n')}`).toEqual([])
  })

  it('法宝被动 / 功法满级 / 分支 / 天赋 / 称号 / 灵兽 / 状态:凡给 speed,都得跨过一档', () => {
    const bad: string[] = []
    const check = (where: string, value: number | undefined): void => {
      if (value !== undefined && value > 0 && value < STEP - 1e-9) bad.push(`${where} ${value}`)
    }
    for (const a of ARTIFACTS) check(`法宝「${a.name}」`, a.passive.speed)
    for (const g of GONGFA) {
      const total = (g.baseMods.speed ?? 0) + (g.perLevelMods.speed ?? 0) * (g.maxLevel - 1)
      check(`功法《${g.name}》满级`, total)
    }
    for (const b of GONGFA_BRANCHES) check(`分支「${b.name}」`, b.mods.speed)
    for (const t of TALENTS) check(`天赋「${t.name}」`, t.mods.speed)
    for (const t of TITLES) check(`称号「${t.name}」`, t.mods.speed)
    for (const p of PETS) check(`灵兽「${p.name}」`, p.mods.speed)
    for (const b of BUFFS) check(`状态「${b.name}」`, b.mods.speed)
    expect(bad, `这些先手加成跨不过任何一档,等于没给:\n${bad.join('\n')}`).toEqual([])
  })
})
