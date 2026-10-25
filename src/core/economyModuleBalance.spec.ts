/**
 * 坊市 / 悬赏 / 收徒 三模块的经济校验(C2·C1)
 * 不入 economySim.auditEra:弟子差事分配、等级曲线是行为假设。只锁结构不变量,取自真实定价/生成函数:
 *  ① 无套利:全境界 购 > 悬赏 > 售,比值不随境界漂移。
 *  ② 弟子材料不衰减(C1):「弟子材料 → 悬赏」价值 ÷ 战斗灵石 恒为常数。
 */
import { describe, expect, it } from 'vitest'
import { stoneByTier } from './formulas'
import { mulN } from '@/utils/gnum'
import { qualityDef } from '@/data/qualities'
import { maxTierForMajor } from '@/data/regions'
import { MAX_MAJOR } from '@/data/realms'
import { mulberry32, RandomService } from '@/utils/random'
import {
  MARKET_PILL_MARKUP,
  MARKET_MAT_STONE_UNITS,
  MARKET_EQUIP_STONE_BASE,
  MARKET_EQUIP_STONE_PER_RANK,
  MARKET_SELL_MAT_STONE_UNITS
} from '@/data/market'
import {
  BOUNTY_MAT_TARGET,
  BOUNTY_MAT_UNIT_AMOUNT,
  BOUNTY_PILL_REWARD_FACTOR,
  BOUNTY_EQUIP_STONE_BASE,
  BOUNTY_EQUIP_STONE_PER_RANK
} from '@/data/bounty'
import { pillSellPrice, consignPrice, herbSellPrice, materialSellPrice, herbSellBatch, generateMarketStock, marketEquipInstance } from './marketService'
import { pillStoneCost } from './pillService'
import { herbBountyReward, generateBounty } from './bountyService'
import { apprenticeSpoils } from './apprenticeService'
import { herbBuyPrice } from './herbPrice'
import { HERB_GRADES } from '@/data/herbGrades'
import { MARKET_MAT_COUNT, MARKET_SELL_PILL_FACTOR } from '@/data/market'
import { PILLS } from '@/data/pills'

/** 境界代表层级,与 economySim 同 */
const tierOf = (major: number): number => maxTierForMajor(major)

function toN(g: { m: number; e: number }): number {
  return g.m * Math.pow(10, g.e)
}

function rng(seed = 0x5eed): RandomService {
  return new RandomService(mulberry32(seed))
}

/** 全部 major 0..最大境界 */
const MAJORS = Array.from({ length: 21 }, (_, i) => i)

/** 灵草三价守卫的代表境界;比值与境界无关,逐境界恒等由 herbGrades.spec「草比石贵恒常」守 */
const HERB_MAJOR = 10

describe('三模块经济审计 · 无套利与弟子不衰减', () => {
  it('① 材料:购(6/单位) > 悬赏(4.5) > 售(3),且比值逐境界恒一', () => {
    for (const major of MAJORS) {
      const buyUnit = MARKET_MAT_STONE_UNITS
      const bountyUnit = BOUNTY_MAT_UNIT_AMOUNT
      const sellUnit = MARKET_SELL_MAT_STONE_UNITS
      expect(bountyUnit, `境 ${major} 悬赏必在购销之间`).toBeGreaterThan(sellUnit)
      expect(buyUnit).toBeGreaterThan(bountyUnit)
    }
    expect(BOUNTY_MAT_UNIT_AMOUNT / MARKET_SELL_MAT_STONE_UNITS).toBeCloseTo(1.5, 5)
    expect(MARKET_MAT_STONE_UNITS / BOUNTY_MAT_UNIT_AMOUNT).toBeCloseTo(4 / 3, 5)
  })

  it('① 丹药:购(×2.5) > 悬赏(×1.8+悟道) > 售(×1.2)', () => {
    for (const major of MAJORS) {
      for (const p of PILLS.filter(x => x.recipe?.stoneBase != null && x.minRealm <= major)) {
        // 用实际炼制石耗 pillStoneCost(层级曲线),不用写死 stoneBase;顶层丹自炼 ~1.7e11
        const craft = toN(pillStoneCost(p))
        const buy = MARKET_PILL_MARKUP * craft
        const bountyPer = BOUNTY_PILL_REWARD_FACTOR * craft // 总赏另乘枚数
        const sell = toN(pillSellPrice(p.id))
        expect(bountyPer, `${p.id} 悬赏>售`).toBeGreaterThan(sell)
        expect(buy, `${p.id} 购>悬赏`).toBeGreaterThan(bountyPer)
        expect(sell / craft, `${p.id} 售=×1.2`).toBeCloseTo(1.2, 4)
      }
    }
  })

  it('① 装备:购(60+30r) > 悬赏(35+14r+器尘) > 摆摊(25+12r);无买→交空转', () => {
    for (const major of MAJORS) {
      const tier = tierOf(major)
      for (const rank of [0, 1, 2, 3, 4, 5]) {
        const buy = stoneByTier(tier, MARKET_EQUIP_STONE_BASE + rank * MARKET_EQUIP_STONE_PER_RANK)
        const bounty = stoneByTier(tier, BOUNTY_EQUIP_STONE_BASE + rank * BOUNTY_EQUIP_STONE_PER_RANK)
        const consign = consignPrice(tier, rank)
        expect(toN(bounty) > toN(consign)).toBe(true)
        expect(toN(buy) > toN(bounty)).toBe(true)
      }
    }
  })

  it('② 弟子材料不衰减(C1):悬赏把弟子固定产的草按 4.5/单位收走,价值÷战斗恒常', () => {
    // 整单募草(30 单位 × 4.5)÷ 一场战斗 = 13.5
    for (const major of MAJORS) {
      const tier = tierOf(major)
      const bountyFull = toN(stoneByTier(tier, BOUNTY_MAT_TARGET * BOUNTY_MAT_UNIT_AMOUNT))
      const battle = toN(stoneByTier(tier, 10))
      const ratio = bountyFull / battle
      expect(ratio, `境 ${major} 弟子整单募草价值÷战斗应恒常`).toBeCloseTo(13.5, 6)
    }
  })

  it('② 弟子石类差事不贬值:历练恒为战斗的固定份额(真调 apprenticeSpoils)', () => {
    // 真调 apprenticeSpoils(基础档),不自算 stoneByTier(tier,4):实现把 major 当 tier 时自算照样绿
    for (const major of MAJORS) {
      const tier = tierOf(major)
      const adventure = toN(apprenticeSpoils('ap_luanniao', 'adventure', major, 1).stone!)
      const battle = toN(stoneByTier(tier, 10))
      expect(adventure / battle, `境 ${major} 历练/战斗应恒常`).toBeCloseTo(0.4, 6)
    }
  })
})

describe('灵草三价无套利守卫(购/悬赏/售)', () => {
  it('每一品:售 = 购价×1/2、悬赏每株 = 购价×3/4,且 购 > 悬赏 > 售(不搬砖)', () => {
    for (const g of HERB_GRADES) {
      const buy = herbBuyPrice(g, HERB_MAJOR)
      const sell = herbSellPrice(g, HERB_MAJOR)
      const bountyPer = toN(herbBountyReward(g, HERB_MAJOR, 1))
      // 常数改回 0.8/0.9(搬砖复活)即红
      expect(sell, `第 ${g} 品售出应=购价×1/2`).toBe(buy / 2)
      // 购价是 4 的倍数 → 购价×3/4 恒整数。GNum toNum 往返有 ±1e-8 相对漂移,须容差比对
      expect(4 * bountyPer).toBeGreaterThan(3 * buy - 0.5)
      expect(4 * bountyPer).toBeLessThan(3 * buy + 0.5)
      expect(Math.round(bountyPer)).toBe(
        Math.floor(buy * (BOUNTY_MAT_UNIT_AMOUNT / MARKET_MAT_STONE_UNITS) + 0.5)
      )
      expect(buy, `第 ${g} 品购价应高于悬赏`).toBeGreaterThan(bountyPer)
      expect(bountyPer, `第 ${g} 品悬赏应高于售出`).toBeGreaterThan(sell)
      expect(Number.isInteger(sell), `第 ${g} 品售出应为整数`).toBe(true)
      expect(Math.abs(bountyPer - Math.round(bountyPer)), `第 ${g} 品悬赏每株应为整数(±<1石)`).toBeLessThan(1e-3)
    }
  })

  it('公式口径与常数一致:售/悬赏就是「购价 × 该档 ÷ 购入档」', () => {
    for (const g of HERB_GRADES) {
      const buy = herbBuyPrice(g, HERB_MAJOR)
      expect(herbSellPrice(g, HERB_MAJOR)).toBe(buy * (MARKET_SELL_MAT_STONE_UNITS / MARKET_MAT_STONE_UNITS))
      expect(Math.round(toN(herbBountyReward(g, HERB_MAJOR, 1)))).toBe(
        Math.floor(buy * (BOUNTY_MAT_UNIT_AMOUNT / MARKET_MAT_STONE_UNITS) + 0.5)
      )
    }
  })
})

describe('坊市定价单调性 + 有限(高阶/珍稀必卖更贵)', () => {
  it('寄卖价随阶单调递增:同一珍稀度下,阶越高卖越贵', () => {
    for (const rank of [0, 1, 2, 3]) {
      let prev = 0
      for (let tier = 1; tier <= 25; tier += 1) {
        const p = toN(consignPrice(tier, rank))
        expect(p, `consign tier=${tier} rank=${rank}`).toBeGreaterThan(prev)
        expect(Number.isFinite(p)).toBe(true)
        prev = p
      }
    }
  })

  it('寄卖价随珍稀度单调递增:同一阶下,品质越高卖越贵', () => {
    for (const tier of [1, 5, 10, 20]) {
      let prev = 0
      for (let rank = 0; rank <= 4; rank += 1) {
        const p = toN(consignPrice(tier, rank))
        expect(p, `consign tier=${tier} rank=${rank}`).toBeGreaterThan(prev)
        prev = p
      }
    }
  })

  it('材料即售价随境界单调递增,且有限为正', () => {
    let prev = 0
    // 价随 maxTierForMajor;1..MAX_MAJOR 内层级严格递增,其后封顶混沌海第 32 层
    for (let major = 1; major <= MAX_MAJOR; major += 1) {
      const p = toN(materialSellPrice(major))
      expect(p, `material major=${major}`).toBeGreaterThan(prev)
      expect(Number.isFinite(p)).toBe(true)
      prev = p
    }
  })

  it('灵草即售价随品级单调递增,且有限为正', () => {
    let prev = 0
    for (const g of HERB_GRADES) {
      const p = herbSellPrice(g, HERB_MAJOR)
      expect(p, `herb grade=${g}`).toBeGreaterThan(prev)
      expect(Number.isFinite(p)).toBe(true)
      prev = p
    }
  })

  it('逐批=单株×单位数:herbSellBatch(g) 恰为 herbSellPrice(g)×货架单位数', () => {
    for (const g of HERB_GRADES) {
      expect(toN(herbSellBatch(g, HERB_MAJOR))).toBeCloseTo(herbSellPrice(g, HERB_MAJOR) * MARKET_MAT_COUNT, 6)
    }
  })
})

/** 只补边界(未知丹、0 阶、负参);比例与单调见上方 describe */
describe('坊市 · 定价健壮性(未知丹 0 元·0 阶负参非负有限)', () => {
  it('未知丹:售价 0 且有限(不 NaN/不∞/不为负)', () => {
    const v = toN(pillSellPrice('not_a_pill'))
    expect(v).toBe(0)
    expect(Number.isFinite(v)).toBe(true)
  })

  it('已知丹:售价恰为炼制石耗 × 1.2(层级曲线,不是写死 stoneBase)', () => {
    const withBase = PILLS.find(p => p.recipe?.stoneBase != null)
    if (!withBase?.recipe?.stoneBase) throw new Error('测试需要一张有灵材底的丹方')
    // 与买价同源
    expect(pillSellPrice(withBase.id)).toEqual(mulN(pillStoneCost(withBase), MARKET_SELL_PILL_FACTOR))
  })

  it('0 阶 / 负参:寄卖与售材价有限非负(不 NaN/不为负)', () => {
    expect(Number.isFinite(toN(consignPrice(0, 0)))).toBe(true)
    expect(toN(consignPrice(0, 0))).toBeGreaterThanOrEqual(0)
    expect(Number.isFinite(toN(materialSellPrice(0)))).toBe(true)
    expect(toN(materialSellPrice(0))).toBeGreaterThanOrEqual(0)
    // 负阶/负品质被 stoneByTier 的 max(0, tier-1) 夹回正
    expect(toN(consignPrice(-1, -1))).toBeGreaterThanOrEqual(0)
    expect(toN(materialSellPrice(-5))).toBeGreaterThanOrEqual(0)
  })
})

/**
 * 单标尺守卫:灵草/匹材/装备/悬赏全骑 1.9^区域层级,不以境界大阶 major 当层级。
 * 材:草 = 6:64 与层级无关;把材退回大阶,比值差两个数量级,本测试即红。
 */
describe('坊市/悬赏 · 材与草骑同一区域层级之尺', () => {
  it('玄铁/募铁与灵草共用 maxTierForMajor(major),不以境界大阶当层级', () => {
    const major = 9
    const tier = maxTierForMajor(major)
    expect(tier, '前提:此境两把尺确实分叉').toBeGreaterThan(major)

    let oreSlot: { price: { m: number; e: number } } | undefined
    for (let s = 0; s < 24 && !oreSlot; s += 1) {
      oreSlot = generateMarketStock(major, rng(s + 1), 1_700_000_000_000).goods.find(
        x => x.kind === 'material' && x.matId === 'ore'
      )
    }
    expect(oreSlot, '若干次生成总该开得出玄铁格').toBeDefined()
    const oreUnit = toN(oreSlot!.price) / MARKET_MAT_COUNT
    const herbUnitRaw = toN(stoneByTier(tier, 64)) // 草一品购价未取整底子
    expect(oreUnit / herbUnitRaw).toBeCloseTo(MARKET_MAT_STONE_UNITS / 64, 5)
    // 确保断言抓得住「大阶当层级」的回退
    const revertedOreUnit = toN(stoneByTier(major, MARKET_MAT_STONE_UNITS))
    expect(revertedOreUnit / herbUnitRaw).toBeLessThan((oreUnit / herbUnitRaw) * 0.01)

    const oreBounty = generateBounty(major, 1_700_000_000_000).find(s => s.kind === 'ore')!.reward
    expect(toN(oreBounty)).toBeCloseTo(toN(stoneByTier(tier, BOUNTY_MAT_TARGET * BOUNTY_MAT_UNIT_AMOUNT)), 5)
  })

  it('坊市装备标价·按「真实交付那一件」的品质而非境界大阶 major —— 买到的品质必与价签对上', () => {
    const major = 9
    const stockedAt = 1_700_000_000_000
    const tier = maxTierForMajor(major)
    expect(tier, '前提:此境两把尺确实分叉').toBeGreaterThan(major)
    let checked = 0
    for (let s = 0; s < 40; s += 1) {
      const stock = generateMarketStock(major, rng(s + 1), stockedAt)
      for (const slot of stock.goods) {
        if (slot.kind !== 'equipment') continue
        const item = marketEquipInstance(slot, stockedAt)
        const rank = qualityDef(item.quality).rank
        const expectPrice = stoneByTier(tier, MARKET_EQUIP_STONE_BASE + rank * MARKET_EQUIP_STONE_PER_RANK)
        expect(toN(slot.price), `货价必须等于交付件品质对应的价(slot#${slot.idx})`).toBe(toN(expectPrice))
        checked += 1
      }
    }
    expect(checked, '应验到若干件装备格').toBeGreaterThan(0)
  })

  it('悬赏贡器门槛用真实层级(marketTier)而非境界大阶 —— 否则「贡 ≥N 阶兵刃」在多数境形同虚设', () => {
    const major = 9
    const tier = maxTierForMajor(major)
    expect(tier, '前提:此境两把尺确实分叉').toBeGreaterThan(major)
    const slot = generateBounty(major, 1_700_000_000_000).find(s => s.kind === 'equip')!
    expect(slot.tier, '贡器门槛应骑在真实层级上(不是拿 major 当层级)').toBe(tier)
  })
})
