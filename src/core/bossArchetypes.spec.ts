/** Boss 机制家族 ARCHETYPES 数据守卫:键与类型联合一一对应、无缺无余、域值有限有界 */
import { describe, expect, it } from 'vitest'
import { ARCHETYPES, type ArchetypeDef } from './bossArchetypes'
import { ENEMIES } from '@/data/enemies'
import { ENEMY_LORE_MAX } from '@/stores/lore'
import { describeEnemy } from '@/ui/enemyLore'
import type { BossArchetype, EnemyDef, EnemySkill, StatMods } from '@/types'

// 须与 types/index.ts 的 BossArchetype 联合逐字对齐
const EXPECTED_ARCHETYPES: BossArchetype[] = [
  'berserk', 'counter', 'truedmg', 'antiheal', 'spellbane', 'evasive', 'attrition', 'threshold'
]

const STAT_PERSONALITY_KEYS = ['atkMult', 'defMult', 'hpMult'] as const

describe('Boss 机制家族 · 数据结构', () => {
  it('键与类型联合一一对应:无缺无余、无重复(round-trip)', () => {
    const keys = Object.keys(ARCHETYPES) as BossArchetype[]
    expect(new Set(keys).size).toBe(keys.length)
    expect([...keys].sort()).toEqual([...EXPECTED_ARCHETYPES].sort())
  })

  it('每个家族的 id 与键一致,名/印/述非空', () => {
    for (const [key, def] of Object.entries(ARCHETYPES) as Array<[BossArchetype, ArchetypeDef]>) {
      expect(def.id, `${key} id`).toBe(key)
      expect(def.name, `${key} name`).toBeTruthy()
      expect(def.desc, `${key} desc`).toBeTruthy()
    }
  })

  it('印(seal)各唯一且为单个汉字(异族不共形、一句一印)', () => {
    const seals = Object.values(ARCHETYPES).map(d => d.seal)
    expect(new Set(seals).size, '印不得重复').toBe(seals.length)
    for (const s of seals) {
      expect(s.length, `印「${s}」应为一个汉字`).toBe(1)
      expect(/\p{Script=Han}/u.test(s), `印「${s}」非汉字`).toBe(true)
    }
  })

  it('核心词条(coreMods)全为有限数', () => {
    for (const [key, def] of Object.entries(ARCHETYPES) as Array<[string, ArchetypeDef]>) {
      for (const v of Object.values(def.coreMods)) {
        expect(Number.isFinite(v), `${key} coreMods 含非有限值`).toBe(true)
      }
    }
  })

  it('数值人格:攻/防/血倍率均有限且为正(不该出现 0/负/NaN 的 Boss)', () => {
    for (const [key, def] of Object.entries(ARCHETYPES) as Array<[string, ArchetypeDef]>) {
      for (const k of STAT_PERSONALITY_KEYS) {
        const v = def.statPersonality[k]
        expect(Number.isFinite(v), `${key} statPersonality.${k}`).toBe(true)
        expect(v! > 0, `${key} statPersonality.${k} 应>0`).toBe(true)
      }
    }
  })

  it('相位阈值在 (0,1) 内,多相位严格递减(跌破才进,顺序不能乱)', () => {
    for (const [key, def] of Object.entries(ARCHETYPES) as Array<[string, ArchetypeDef]>) {
      const ph = def.phases
      for (let i = 0; i < ph.length; i += 1) {
        const t = ph[i]!.hpThreshold
        expect(t > 0 && t < 1, `${key} phase[${i}] hpThreshold=${t} 应 ∈(0,1)`).toBe(true)
        if (i > 0) {
          expect(ph[i]!.hpThreshold, `${key} 相位阈值应严格递减`).toBeLessThan(ph[i - 1]!.hpThreshold)
        }
      }
    }
  })

  it('技能(核心/相位)mult 有限为正,rate 在 (0,1] 内', () => {
    for (const [key, def] of Object.entries(ARCHETYPES) as Array<[string, ArchetypeDef]>) {
      const skills = [...def.coreSkills, ...def.phases.flatMap(p => p.skillChanges ?? [])]
      for (const sk of skills) {
        expect(Number.isFinite(sk.mult) && sk.mult > 0, `${key} skill "${sk.name}" mult`).toBe(true)
        expect(sk.rate > 0 && sk.rate <= 1, `${key} skill "${sk.name}" rate`).toBe(true)
        expect(sk.name, `${key} 技能名非空`).toBeTruthy()
      }
    }
  })
})

const BOSSES = ENEMIES.filter(d => d.isBoss && d.archetype)
const baseMod = (d: EnemyDef, k: keyof StatMods): number => d.mods?.[k] ?? 0
const allSkills = (d: EnemyDef): EnemySkill[] => [...d.skills, ...(d.phases ?? []).flatMap(p => p.skillChanges ?? [])]

/**
 * 各家本相句所说的打法,对照战斗里真实生效的配置。
 * 盾认常驻词条、招式与阶段抬高的 shieldOnStart(入阶段补差额)。
 */
const CLAIMS: Record<BossArchetype, (d: EnemyDef) => boolean> = {
  berserk: d => (d.phases ?? []).some(p => (p.modChanges?.damageBonus ?? 0) > baseMod(d, 'damageBonus')),
  counter: d => baseMod(d, 'counterRate') > 0,
  truedmg: d => d.skills.some(s => s.effect === 'pierce'),
  antiheal: d => baseMod(d, 'lifesteal') > 0,
  spellbane: d => baseMod(d, 'damageReduction') > 0,
  evasive: d => baseMod(d, 'dodgeRate') > 0,
  attrition: d => baseMod(d, 'regenPerRound') > 0,
  threshold: d =>
    baseMod(d, 'shieldOnStart') > 0 ||
    allSkills(d).some(s => s.effect === 'shield') ||
    (d.phases ?? []).some(p => (p.modChanges?.shieldOnStart ?? 0) > baseMod(d, 'shieldOnStart'))
}

describe('Boss 本相 · 名实相符', () => {
  it('每只首领都做得到自家本相所说的事', () => {
    const misfits = BOSSES.filter(d => !CLAIMS[d.archetype!](d)).map(d => `${d.id}(${d.archetype})`)
    expect(misfits).toEqual([])
  })

  it('本相句或家族描述写「开战」的,其下首领开战即带盾', () => {
    const misfits = BOSSES.filter(d => {
      const said = `${describeEnemy(d, ENEMY_LORE_MAX).archetype ?? ''}${ARCHETYPES[d.archetype!].desc}`
      return said.includes('开战') && baseMod(d, 'shieldOnStart') <= 0
    }).map(d => d.id)
    expect(misfits).toEqual([])
  })

  it('吸血一家:标签说吸血,不说压治疗', () => {
    const members = BOSSES.filter(d => d.archetype === 'antiheal')
    expect(members.length).toBeGreaterThan(0)
    for (const d of members) {
      const label = describeEnemy(d, ENEMY_LORE_MAX).archetypeLabel ?? ''
      expect(label, d.id).toContain('吸血')
      expect(label, d.id).not.toMatch(/治疗|禁/)
    }
  })
})
