/* eslint-disable no-console -- 灵脉与重铸经济审计 */
/** 灵脉投资与重铸成本经济审计:灵脉不退化为延迟点满,重铸不允许无限洗完美装 */
import { describe, expect, it } from 'vitest'
import {
  REFORGE_SEAL_LOAD,
  STONE_TIER_GROWTH,
  VEIN_MAIN_CAPACITY,
  VEIN_POINT_STONE,
  VEIN_SIDE_CAP,
  VEIN_TOTAL_CAPACITY
} from '@/data/constants'
import { VEINS } from '@/data/veins'
import { veinEffectText } from '@/ui/veinText'
import { reforgeCost } from './reforge'
import { stoneByTier } from './formulas'
import type { EquipmentInstance } from '@/types'

describe('Phase 30.5:灵脉投资终局审计', () => {
  it('灵脉容量设计:总量100点形成主副脉取舍', () => {
    console.log('\n—— Phase 30.5 灵脉投资容量设计 ——')
    console.log(`  总容量: ${VEIN_TOTAL_CAPACITY} 点`)
    console.log(`  主脉上限: ${VEIN_MAIN_CAPACITY} 点`)
    console.log(`  副脉上限: 各 ${VEIN_SIDE_CAP} 点`)

    const veinCount = VEINS.length
    const fullSideCap = veinCount * VEIN_SIDE_CAP
    console.log(`  若4脉均投满副脉上限: ${fullSideCap} 点(超出总容量 ${fullSideCap - VEIN_TOTAL_CAPACITY} 点)`)

    const remainAfterMain = VEIN_TOTAL_CAPACITY - VEIN_MAIN_CAPACITY
    console.log(`  主脉投满后剩余: ${remainAfterMain} 点(可投满1副脉,另2脉无法投满)`)

    expect(VEIN_TOTAL_CAPACITY, '总容量应形成约束').toBeLessThan(fullSideCap)
    expect(remainAfterMain, '主脉投满后应无法投满所有副脉').toBeLessThan(VEIN_SIDE_CAP * (veinCount - 1))
  })

  it('灵脉四脉定义:各脉增益明确,形成不同流派偏好', () => {
    console.log('\n  灵脉定义:')
    for (const def of VEINS) {
      console.log(`    ${def.name}(${def.id}): ${def.desc}`)
      console.log(`      满级增益: ${veinEffectText(def, VEIN_MAIN_CAPACITY)}`)
    }

    for (let i = 0; i < VEINS.length; i++) {
      for (let j = i + 1; j < VEINS.length; j++) {
        const a = VEINS[i]!
        const b = VEINS[j]!
        const diff = JSON.stringify(a.perPoint) !== JSON.stringify(b.perPoint)
        expect(diff, `${a.name} 与 ${b.name} 增益应有差异`).toBe(true)
      }
    }
  })

  it('投点成本曲线:按层级递增,中后期形成资源压力', () => {
    console.log('\n  单点投资成本(按层级):')
    const tiers = [
      { name: '练气', tier: 1 },
      { name: '筑基', tier: 2 },
      { name: '金丹', tier: 3 },
      { name: '元婴', tier: 4 },
      { name: '化神', tier: 5 },
    ]

    const costs: Array<{ tier: number; cost: { m: number; e: number } }> = []
    for (const { name, tier } of tiers) {
      const cost = stoneByTier(tier, VEIN_POINT_STONE)
      costs.push({ tier, cost })
      console.log(`    ${name}(T${tier}): ${cost.m.toFixed(2)}e${cost.e} 灵石/点`)
    }

    for (let i = 1; i < costs.length; i++) {
      const prev = costs[i - 1]!
      const curr = costs[i]!
      const prevVal = prev.cost.m * Math.pow(10, prev.cost.e)
      const currVal = curr.cost.m * Math.pow(10, curr.cost.e)
      expect(currVal, `T${curr.tier} 成本应大于 T${prev.tier}`).toBeGreaterThan(prevVal)
    }

    // 以金丹(灵脉解锁层级)计
    const jindan = costs.find(c => c.tier === 3)!
    const fullMainCost = {
      m: jindan.cost.m * VEIN_MAIN_CAPACITY,
      e: jindan.cost.e,
    }
    console.log(`\n  投满一条主脉总成本(金丹): ${fullMainCost.m.toFixed(2)}e${fullMainCost.e} 灵石`)
    console.log(`    (${VEIN_MAIN_CAPACITY} 点 × ${jindan.cost.m.toFixed(2)}e${jindan.cost.e}/点)`)

    expect(fullMainCost.m, '投满主脉总成本应显著').toBeGreaterThan(50)
  })

  it('灵脉容量模拟:三种策略的资源分配', () => {
    console.log('\n  灵脉投资策略模拟:')

    const strategies = [
      { name: '专精主脉', main: 70, sides: [10, 10, 10], total: 100 },
      { name: '主副兼顾', main: 70, sides: [30, 0, 0], total: 100 },
      { name: '均衡四脉', main: 40, sides: [20, 20, 20], total: 100 },
    ]

    for (const s of strategies) {
      console.log(`    ${s.name}: 主脉${s.main}点 + 副脉[${s.sides.join(',')}]点 = ${s.total}点`)
    }

    console.log('\n  关键约束:')
    console.log('    - 总容量100点无法投满所有副脉(4×30=120点)')
    console.log('    - 主脉迁移有成本(20×单点成本),已投点数不回收')
    console.log('    - 形成长期取舍:深修单脉 vs 广泛涉猎')

    expect(strategies.length).toBe(3)
  })
})

describe('Phase 30.5:装备重铸成本审计(机制已实现,行为验证)', () => {
  const base: EquipmentInstance = {
    uid: 'u1',
    templateId: 'w_zhuqing',
    quality: 'mortal',
    tier: 3,
    level: 0,
    affixes: [
      { id: 'atk1', roll: 0.5 },
      { id: 'def1', roll: 0.5 }
    ],
    reforgeCount: 0
  }
  const stoneOf = (c: { m: number; e: number }): number => c.m * Math.pow(10, c.e)

  /** 重铸成本只看阶数与封存数,不限次数(见 data/constants) */
  it('品质与重铸成本无关:同一件洗到第几次、什么品质,都是同一个价', () => {
    const c0 = reforgeCost({ ...base, reforgeCount: 0, quality: 'mortal' })!
    const c99 = reforgeCost({ ...base, reforgeCount: 99, quality: 'divine' })!
    expect(stoneOf(c99.stone)).toBeCloseTo(stoneOf(c0.stone), 6)
    expect(c99.dust).toBe(c0.dust)
  })

  it('不限次数:洗到第两百次仍可重铸(次数只作记录,不进公式)', () => {
    expect(reforgeCost({ ...base, reforgeCount: 200 }), '不该再有次数上限').not.toBeNull()
  })

  it('成本随封存数线性上浮:每封存一条 +REFORGE_SEAL_LOAD', () => {
    const one = reforgeCost({ ...base, affixes: [...base.affixes, { id: 'hp1', roll: 0.5 }], sealedAffixIds: ['atk1'] })!
    const two = reforgeCost({ ...base, affixes: [...base.affixes, { id: 'hp1', roll: 0.5 }], sealedAffixIds: ['atk1', 'def1'] })!
    expect(stoneOf(two.stone) / stoneOf(one.stone)).toBeCloseTo((1 + 2 * REFORGE_SEAL_LOAD) / (1 + REFORGE_SEAL_LOAD), 6)
  })

  it('层阶越高,重铸越贵(与掉落同轴 stoneByTier)', () => {
    const t3 = reforgeCost({ ...base, tier: 3 })!
    const t10 = reforgeCost({ ...base, tier: 10 })!
    expect(stoneOf(t10.stone) / stoneOf(t3.stone)).toBeCloseTo(Math.pow(STONE_TIER_GROWTH, 7), 4)
  })

  it('「暴力洗完美」的刹车换到了别处:高阶层 + 封存溢价,而不是次数', () => {
    const cheap = stoneOf(reforgeCost({ ...base, tier: 3 })!.stone)
    const dear = stoneOf(
      reforgeCost({
        ...base,
        tier: 20,
        affixes: [...base.affixes, { id: 'hp1', roll: 0.5 }, { id: 'crit1', roll: 0.5 }, { id: 'luck1', roll: 0.5 }],
        sealedAffixIds: ['atk1', 'def1', 'hp1']
      })!.stone
    )
    console.log(`\n  3 阶未封存 ${cheap.toExponential(2)} → 20 阶封存三条 ${dear.toExponential(2)}(×${(dear / cheap).toFixed(0)})`)
    expect(dear / cheap).toBeGreaterThan(1000)
  })
})

describe('Phase 30.5:灵石 Sink 渠道', () => {
  it('灵脉投资与装备重铸都是真实的灵石去向(不再有待实现项)', () => {
    const veinFull = stoneByTier(3, VEIN_POINT_STONE).m * Math.pow(10, stoneByTier(3, VEIN_POINT_STONE).e) * VEIN_MAIN_CAPACITY
    const eq: EquipmentInstance = {
      uid: 'u2',
      templateId: 'w_zhuqing',
      quality: 'excellent',
      tier: 3,
      level: 0,
      affixes: [
        { id: 'atk1', roll: 0.5 },
        { id: 'def1', roll: 0.5 }
      ],
      reforgeCount: 9
    }
    const reforge = reforgeCost(eq)!
    const reforgeStone = reforge.stone.m * Math.pow(10, reforge.stone.e)
    console.log(`\n  投满主脉(金丹)≈ ${veinFull.toExponential(2)} 灵石;重铸一次(金丹精品)≈ ${reforgeStone.toExponential(2)} 灵石`)
    expect(veinFull).toBeGreaterThan(0)
    expect(reforgeStone).toBeGreaterThan(0)
  })
})
