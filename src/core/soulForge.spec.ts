/* eslint-disable no-console */
/**
 * 凡界装备在天界照常作数(三维与词条都算),器魂是叠加层,不压缩。
 * 堆叠代价在敌人判定(gauntlet.celestialJudgement):构筑越厚,守关者三维加厚 + 增伤 + 减伤,判定有上限。
 */
import { describe, expect, it } from 'vitest'
import type { StatMods } from '@/types'
import { modDepth } from './statsCalc'
import { SOUL_GRADES, SOUL_SLOTS, SOUL_TYPES, soulMods, type SoulInstance } from '@/data/souls'
import { celestialDepthScale, celestialJudgement } from './gauntlet'

/** 按比例放大词条:同方向、堆得更厚 */
function scaleMods(mods: StatMods, k: number): StatMods {
  const out: StatMods = {}
  for (const key in mods) out[key as keyof StatMods] = (mods[key as keyof StatMods] ?? 0) * k
  return out
}

function soulAt(type: SoulInstance['type'], grade: number, uid = 's'): SoulInstance {
  return { uid, type, grade, fromName: '测试' }
}

const HEAVY: StatMods = { critRate: 0.9, critDamage: 2.4, lifesteal: 0.7, comboRate: 0.5 }

describe('器魂 · 是加法的一层', () => {
  it('两枚器魂的深度相加 —— 没有"压到容量"这一步', () => {
    const one = modDepth(soulMods(soulAt(SOUL_TYPES[0]!.id, 5, 'a')))
    const two =
      modDepth(soulMods(soulAt(SOUL_TYPES[0]!.id, 5, 'a'))) + modDepth(soulMods(soulAt(SOUL_TYPES[1]!.id, 5, 'b')))
    expect(one).toBeGreaterThan(0)
    expect(two).toBeGreaterThan(one)
  })

  it('品阶越高,器魂越厚(它现在是实打实的战力,不再只是形状)', () => {
    const low = modDepth(soulMods(soulAt(SOUL_TYPES[0]!.id, 0, 'a')))
    const high = modDepth(soulMods(soulAt(SOUL_TYPES[0]!.id, SOUL_GRADES.length - 1, 'a')))
    expect(high).toBeGreaterThan(low)
    expect(high).toBeLessThan(low * 4)
  })

  it('三枚满配的合计深度有界 —— 凝魂是投入,不该改写整个构筑尺度', () => {
    const best = SOUL_TYPES.slice(0, SOUL_SLOTS).map<SoulInstance>((t, i) =>
      soulAt(t.id, SOUL_GRADES.length - 1, `s${i}`)
    )
    const total = best.reduce((sum, s) => sum + modDepth(soulMods(s)), 0)
    console.log(`\n三枚化真器魂合计深度 ${total.toFixed(2)}`)
    expect(total).toBeGreaterThan(0.5)
    expect(total, '三枚器魂的深度上限 —— 再厚也不该越过基准深度太多').toBeLessThan(2.5)
  })

  it('方向不同则器魂不同 —— 天界仍有构筑空间', () => {
    const a = soulMods(soulAt(SOUL_TYPES[0]!.id, 3, 'a'))
    const b = soulMods(soulAt(SOUL_TYPES[1]!.id, 3, 'b'))
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    const differs = [...keys].some(k => (a[k as keyof StatMods] ?? 0) !== (b[k as keyof StatMods] ?? 0))
    expect(differs, '两枚不同类型的器魂给出了同一份词条').toBe(true)
  })
})

describe('器魂 · 厚度的代价落在敌人判定上', () => {
  it('浅构筑不触发判定,厚构筑被加厚且被看破/挡住', () => {
    const thin = celestialJudgement({}, 20, 22)
    const thick = celestialJudgement(scaleMods(HEAVY, 3), 20, 22)
    expect(thin.thicken, '浅构筑不触发判定').toBe(1)
    expect(thin.damageBonus).toBe(0)
    expect(thick.thicken, '厚构筑该被加厚').toBeGreaterThan(1)
    expect(thick.damageBonus, '厚构筑该被看破(增伤)').toBeGreaterThan(0)
    expect(thick.damageReduction, '厚构筑该被挡住(减伤)').toBeGreaterThan(0)
  })

  it('判定有上限:让它难缠,不是把你打回原点', () => {
    const absurd = celestialJudgement(scaleMods(HEAVY, 500), 20, 22)
    expect(absurd.damageBonus).toBeLessThanOrEqual(0.35 + 1e-9)
    expect(absurd.damageReduction).toBeLessThanOrEqual(0.35 + 1e-9)
    // 加厚不封顶;封顶的只有增伤与减伤
    expect(celestialDepthScale(scaleMods(HEAVY, 500))).toBeGreaterThan(1)
  })

  it('判定随厚度单调:再厚一点,守关者只会更有备', () => {
    let prev = celestialJudgement({}, 20, 22).thicken
    for (const k of [1, 2, 4, 8, 16]) {
      const now = celestialJudgement(scaleMods(HEAVY, k), 20, 22).thicken
      expect(now).toBeGreaterThanOrEqual(prev)
      prev = now
    }
  })
})
