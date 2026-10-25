/* eslint-disable no-console -- 倍数表是给人看的 */
/**
 * 顿悟两个战斗向选项(锤炼筋骨 / 凝气护体)须同量级,谁都不是唯一解。
 * 判据不看名义值,拿真引擎打一场换算到同一把尺:
 *   输出倍数 = 带 buff 打出的总伤害 / 不带
 *   生存倍数 = 不带时承受的总伤害 / 带 buff 承受的
 */
import { describe, expect, it } from 'vitest'
import { resolveCombat } from './combat'
import { buffDef } from '@/data/buffs'
import { ENLIGHTENMENT_OPTIONS } from '@/data/earlyGame'
import { mulberry32, RandomService } from '@/utils/random'
import { gn } from '@/utils/gnum'
import type { BuffDef, StatMods } from '@/types'

type CombatantSnap = Parameters<typeof resolveCombat>[0]

/** 血极大、打不死:量的是整场伤害流量,不是胜负 */
function snap(isPlayer: boolean, mods: StatMods): CombatantSnap {
  return {
    name: isPlayer ? '我' : '敌',
    icon: '',
    isPlayer,
    attack: gn(isPlayer ? 1000 : 600),
    defense: gn(isPlayer ? 500 : 600),
    maxHp: { m: 1, e: 9 },
    speed: 1,
    mods,
    skills: []
  }
}

/** 伤害有方差,多场取总量 */
const SAMPLES = 24

function measure(mods: StatMods): { dealt: number; taken: number } {
  let dealt = 0
  let taken = 0
  for (let seed = 1; seed <= SAMPLES; seed += 1) {
    const result = resolveCombat(snap(true, mods), snap(false, {}), new RandomService(mulberry32(seed)), undefined, false)
    dealt += Number(result.stats!.player.dealt.m) * 10 ** result.stats!.player.dealt.e
    taken += Number(result.stats!.player.taken.m) * 10 ** result.stats!.player.taken.e
  }
  return { dealt, taken }
}

function combatOptions(): { label: string; desc: string; def: BuffDef }[] {
  return ENLIGHTENMENT_OPTIONS.filter(o => o.type === 'combat' && o.buffId).map(o => ({
    label: o.label,
    desc: o.desc,
    def: buffDef(o.buffId!)!
  }))
}

/** 同量级带宽 */
const BAND = [1.1, 1.25] as const
const MAX_GAP = 0.05

describe('顿悟 · 两个战斗向选项同量级', () => {
  const opts = combatOptions()

  it('战斗向的选项恰好两条(池子变了,判据要跟着改)', () => {
    expect(opts.map(o => o.label).sort()).toEqual(['凝气护体', '锤炼筋骨'])
  })

  it('两条各挂一个纯乘数词条 —— 实际收益不许取决于玩家自己的攻防比', () => {
    const PURE_MULTIPLIER = new Set(['damageBonus', 'damageReduction'])
    for (const { label, def } of opts) {
      const keys = Object.keys(def.mods)
      expect(keys, `「${label}」挂了不止一个词条,倍数就没法比`).toHaveLength(1)
      expect(
        PURE_MULTIPLIER.has(keys[0]!),
        `「${label}」挂的是 ${keys[0]},它不是纯乘数 —— 实际收益会随攻防比漂`
      ).toBe(true)
    }
  })

  it('面板写的与 buff 挂的是同一件事 —— 减伤就不许写成防御加成', () => {
    for (const { label, desc, def } of opts) {
      if (def.mods.damageReduction) {
        expect(desc, `「${label}」挂的是减伤,面板却写成别的`).toMatch(/受伤|伤害/)
        expect(desc, `「${label}」挂的是减伤,面板不许写防御`).not.toContain('防御')
      }
      if (def.mods.damageBonus) {
        expect(desc, `「${label}」挂的是增伤,面板却不提伤害`).toContain('伤害')
      }
    }
  })

  it('两条时长相同 —— 不然「同量级」是在比不同时长的东西', () => {
    expect(new Set(opts.map(o => o.def.durationSec)).size).toBe(1)
  })

  it('各自的实际倍数都落在 1.10~1.25,且两者相差不超过 0.05', () => {
    const base = measure({})
    const rows = opts.map(({ label, def }) => {
      const buffed = measure(def.mods)
      const offense = buffed.dealt / base.dealt
      const survivability = base.taken / buffed.taken
      return { label, offense, survivability, mult: def.mods.damageBonus ? offense : survivability }
    })
    console.log(
      ['  选项        输出倍数   生存倍数', ...rows.map(r => `  ${r.label}      ×${r.offense.toFixed(3)}     ×${r.survivability.toFixed(3)}`)].join(
        '\n'
      )
    )
    for (const r of rows) {
      expect(r.mult, `「${r.label}」的实际倍数 ${r.mult.toFixed(3)} 低于 ${BAND[0]}`).toBeGreaterThanOrEqual(BAND[0])
      expect(r.mult, `「${r.label}」的实际倍数 ${r.mult.toFixed(3)} 超出 ${BAND[1]}`).toBeLessThanOrEqual(BAND[1])
    }
    const [a, b] = rows.map(r => r.mult) as [number, number]
    expect(Math.abs(a - b), `两个选项差了 ${Math.abs(a - b).toFixed(3)} 倍 —— 选择退化成唯一解`).toBeLessThanOrEqual(
      MAX_GAP
    )
  })
})

describe('判据自证 · 它认得出旧的「防御加成」', () => {
  it('把纯乘数换成 defensePct,量出来的减伤远低于带宽', () => {
    const base = measure({})
    const legacy = measure({ defensePct: 0.12 })
    // defensePct 由 finalStats 折进基础防御,战斗层不读:塞进 mods 生存倍数为 1.000
    const survivability = base.taken / legacy.taken
    expect(survivability, 'defensePct 被当成本场减伤量到了,判据在自欺').toBeLessThan(BAND[0])
  })

  it('离谱的增伤会被量到带宽之外', () => {
    const base = measure({})
    const huge = measure({ damageBonus: 0.8 })
    expect(huge.dealt / base.dealt).toBeGreaterThan(BAND[1])
  })
})
