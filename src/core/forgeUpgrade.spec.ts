/**
 * 强化 · 报价与掷点:成本三样(尘/石/修为)、成功率随级递减、失手掉一级而每 10 级保级、连试失手即停。
 * 掷点一律打桩:成功走 Math.random()=0(必在 rate 之内),失手走 Math.random()=1(必在 rate 之外)。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { EquipmentInstance, GNum } from '@/types'
import { useInventoryStore } from '@/stores/inventory'
import { usePlayerStore } from '@/stores/player'
import { useResourcesStore } from '@/stores/resources'
import { useQuestsStore } from '@/stores/quests'
import { useUiStore } from '@/stores/ui'
import { ACHIEVEMENTS } from '@/data/achievements'
import { MAIN_QUESTS } from '@/data/quests'
import { UPGRADE_SAFE_STEP, UPGRADE_SUCCESS_FLOOR } from '@/data/constants'
import { add, gn, gnZero, sub, toNum } from '@/utils/gnum'
import { upgradeCost, upgradeFailLevel, upgradeSuccessRate } from './formulas'
import {
  equipLevelCap,
  equipUpgradeQuote,
  upgradeBatchPlan,
  upgradeEquipment,
  upgradeEquipmentBatch,
  upgradeShortfall
} from './forge'

/** 夹具:凡品 rank 0,upgradeCost 只吃 level/tier,折扣恒 0 */
function mk(uid: string, level: number): EquipmentInstance {
  return { uid, templateId: 'b_qingyun', quality: 'mortal', tier: 3, level, affixes: [] }
}

function seat(item: EquipmentInstance): void {
  useInventoryStore().items = [item]
}

/** 尘与修为给到用不完(修为是 GNum,与灵石同量纲) */
function rich(): void {
  useResourcesStore().dust = 1_000_000_000
  useResourcesStore().spiritStone = gn(1e30)
  usePlayerStore().exp = gn(1e30)
}

function costOf(lv: number): { dust: number; stone: GNum; exp: GNum } {
  return upgradeCost(lv, 3, 0, 0)
}

/** 0..n-1 级成本累计 */
function sumUpTo(n: number): { dust: number; stone: GNum; exp: GNum } {
  let dust = 0
  let stone = gnZero()
  let exp = gnZero()
  for (let i = 0; i < n; i += 1) {
    dust += costOf(i).dust
    stone = add(stone, costOf(i).stone)
    exp = add(exp, costOf(i).exp)
  }
  return { dust, stone, exp }
}

/** 掷点打桩:0 → 必成;1 → 必失手(rate 最大 1,故需严格小于才成) */
function roll(always: 'success' | 'fail'): void {
  vi.spyOn(Math, 'random').mockReturnValue(always === 'success' ? 0 : 1)
}

afterEach(() => vi.restoreAllMocks())

describe('强化成功率 · 逐级递减与保级点', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('0 级必成,每级递减,到下限不再降', () => {
    expect(upgradeSuccessRate(0)).toBe(1)
    expect(upgradeSuccessRate(1)).toBeLessThan(1)
    expect(upgradeSuccessRate(5)).toBeLessThan(upgradeSuccessRate(4))
    // 100 级远超任何上限,只验下限
    expect(upgradeSuccessRate(999)).toBeCloseTo(UPGRADE_SUCCESS_FLOOR, 6)
  })

  it('失手掉一级,但踩在保级点上不掉级', () => {
    expect(upgradeFailLevel(7, UPGRADE_SAFE_STEP)).toBe(6)
    expect(upgradeFailLevel(10, UPGRADE_SAFE_STEP)).toBe(10)
    expect(upgradeFailLevel(11, UPGRADE_SAFE_STEP)).toBe(10)
    expect(upgradeFailLevel(20, UPGRADE_SAFE_STEP)).toBe(20)
    expect(upgradeFailLevel(0, UPGRADE_SAFE_STEP)).toBe(0)
  })

  it('报价里 rate / failLevel / safe 与公式同源', () => {
    seat(mk('q', 0))
    rich()
    const q0 = equipUpgradeQuote('q')!
    expect(q0.rate).toBe(1)
    expect(q0.safe).toBe(true)
    expect(toNum(q0.exp)).toBeGreaterThan(0)
    seat(mk('q', 7))
    const q7 = equipUpgradeQuote('q')!
    expect(q7.rate).toBeCloseTo(upgradeSuccessRate(7), 6)
    expect(q7.failLevel).toBe(6)
    expect(q7.safe).toBe(false)
    seat(mk('q', 10))
    expect(equipUpgradeQuote('q')!.safe).toBe(true)
  })
})

describe('强化连升 · 批量账', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('计划只算不动手:到顶时 attempts=上限、花费=各级成本之和、资源分文未动', () => {
    seat(mk('a', 0))
    rich()
    const r = useResourcesStore()
    const beforeDust = r.dust
    const beforeStone = { ...r.spiritStone }
    const beforeExp = { ...usePlayerStore().exp }
    const plan = upgradeBatchPlan('a')
    const expectTotal = sumUpTo(equipLevelCap())
    expect(plan.attempts).toBe(equipLevelCap())
    expect(plan.dust).toBe(expectTotal.dust)
    expect(plan.stone).toEqual(expectTotal.stone)
    expect(plan.exp).toEqual(expectTotal.exp)
    expect(plan.atCap).toBe(true)
    expect(r.dust).toBe(beforeDust)
    expect(r.spiritStone).toEqual(beforeStone)
    expect(usePlayerStore().exp).toEqual(beforeExp)
  })

  it('余额恰够两级:attempts=2、总花费=前两级之和、atCap=false', () => {
    seat(mk('b', 0))
    const r = useResourcesStore()
    r.dust = costOf(0).dust + costOf(1).dust
    r.spiritStone = gn(1e30)
    usePlayerStore().exp = gn(1e30)
    const plan = upgradeBatchPlan('b')
    expect(plan.attempts).toBe(2)
    expect(plan.dust).toBe(costOf(0).dust + costOf(1).dust)
    expect(plan.stone).toEqual(add(costOf(0).stone, costOf(1).stone))
    expect(plan.exp).toEqual(add(costOf(0).exp, costOf(1).exp))
    expect(plan.atCap).toBe(false)
  })

  it('连一级都不够:attempts=0、不标 atCap、零花费', () => {
    seat(mk('c', 0))
    const plan = upgradeBatchPlan('c') // 三样皆 0
    expect(plan.attempts).toBe(0)
    expect(plan.atCap).toBe(false)
    expect(plan.dust).toBe(0)
    expect(plan.stone).toEqual(gnZero())
    expect(plan.exp).toEqual(gnZero())
  })

  it('修为不够也停:尘石充裕而修为空虚时同样连不动', () => {
    seat(mk('c2', 0))
    const r = useResourcesStore()
    r.dust = 1_000_000_000
    r.spiritStone = gn(1e30)
    usePlayerStore().exp = gnZero()
    expect(upgradeBatchPlan('c2').attempts).toBe(0)
  })

  it('已至上限:attempts=0 且 atCap=true(不是钱不够)', () => {
    seat(mk('d', equipLevelCap()))
    rich()
    const plan = upgradeBatchPlan('d')
    expect(plan.attempts).toBe(0)
    expect(plan.atCap).toBe(true)
  })

  it('品质越高每级越贵:同阶同级不同品质,品质线的差价体现在计划里', () => {
    const mortal = mk('m1', 0)
    const excellent: EquipmentInstance = { ...mortal, uid: 'e1', quality: 'excellent' }
    useInventoryStore().items = [mortal, excellent]
    rich()
    expect(upgradeBatchPlan('e1').dust).toBeGreaterThan(upgradeBatchPlan('m1').dust)
  })

  it('批量执行:一路全成时一次升到位,扣款与计划一致', () => {
    seat(mk('e', 0))
    const r = useResourcesStore()
    r.dust = costOf(0).dust + costOf(1).dust
    r.spiritStone = gn(1e30)
    usePlayerStore().exp = gn(1e30)
    roll('success')
    expect(upgradeEquipmentBatch('e')).toBe(2)
    const inst = useInventoryStore().findItem('e')!
    expect(inst.level).toBe(2)
    expect(inst.invested!.dust).toBe(costOf(0).dust + costOf(1).dust)
    expect(r.dust).toBe(0)
  })

  it('批量执行:失手即停,只升到失手前那一级', () => {
    seat(mk('e2', 0))
    rich()
    // 首次必成(0 级 rate=1),第二次在 1 级掷出 1 必失手
    const spy = vi.spyOn(Math, 'random')
    spy.mockReturnValueOnce(0).mockReturnValue(1)
    expect(upgradeEquipmentBatch('e2')).toBe(1)
    // 1 级失手回落至 0 级(1-1=0)
    expect(useInventoryStore().findItem('e2')!.level).toBe(0)
  })

  it('批量执行:升不动时不扣一分、level 不动、返回 0', () => {
    seat(mk('f', 0))
    const r = useResourcesStore()
    r.dust = 0
    r.spiritStone = gn(0)
    usePlayerStore().exp = gnZero()
    expect(upgradeEquipmentBatch('f')).toBe(0)
    expect(useInventoryStore().findItem('f')!.level).toBe(0)
    expect(r.dust).toBe(0)
  })

  it('缺料写实际差额:三样各差多少,不是报总价', () => {
    seat(mk('g', 0))
    const r = useResourcesStore()
    const cost = costOf(0)
    r.dust = Math.max(0, cost.dust - 2)
    r.spiritStone = sub(cost.stone, gn(7))
    usePlayerStore().exp = sub(cost.exp, gn(3))
    const gap = upgradeShortfall(cost)
    expect(gap.dust).toBe(2)
    expect(toNum(gap.stone)).toBeCloseTo(7, 6)
    expect(toNum(gap.exp)).toBeCloseTo(3, 6)
  })
})

describe('炼器 · 单步强化(upgradeEquipment)边界', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('成功:升一级、精确扣尘石修为三样、invested 累计(分解八成返还的账本)', () => {
    seat(mk('a', 0))
    // 预先结清成就/主线:首次强化成就赏会混进差额
    useQuestsStore().$patch({ achieved: ACHIEVEMENTS.map(a => a.id), mainIdx: MAIN_QUESTS.length - 1 })
    // 灵石/修为用 1e6:1e30 下几十石的成本被浮点精度吞掉
    const r = useResourcesStore()
    r.dust = 1_000_000
    r.spiritStone = gn(1_000_000)
    usePlayerStore().exp = gn(1_000_000)
    const d0 = r.dust
    const s0 = { ...r.spiritStone }
    const e0 = { ...usePlayerStore().exp }
    // 预期取 equipUpgradeQuote(含当前 forgeDiscount),不手写 discount=0
    const cost = equipUpgradeQuote('a')!
    roll('success')
    expect(upgradeEquipment('a')).toBe('up')
    const item = useInventoryStore().findItem('a')!
    expect(item.level).toBe(1)
    expect(r.dust).toBe(d0 - cost.dust)
    expect(toNum(sub(s0, r.spiritStone))).toBeCloseTo(toNum(cost.stone), 6)
    expect(toNum(sub(e0, usePlayerStore().exp))).toBeCloseTo(toNum(cost.exp), 6)
    expect(item.invested?.dust).toBe(cost.dust)
    expect(toNum(item.invested?.stone ?? gnZero())).toBeCloseTo(toNum(cost.stone), 6)
  })

  it('失手:level 掉一级,但尘石修为照扣(先付后掷)', () => {
    seat(mk('h', 6))
    const r = useResourcesStore()
    r.dust = 1_000_000
    r.spiritStone = gn(1_000_000)
    usePlayerStore().exp = gn(1_000_000)
    const cost = equipUpgradeQuote('h')!
    const d0 = r.dust
    roll('fail')
    expect(upgradeEquipment('h')).toBe('fail')
    expect(useInventoryStore().findItem('h')!.level).toBe(5)
    expect(r.dust).toBe(d0 - cost.dust)
    expect(useUiStore().toasts.at(-1)?.text).toContain('回落')
  })

  it('失手踩在保级点:level 不动,仍照扣', () => {
    seat(mk('h2', UPGRADE_SAFE_STEP))
    rich()
    const cost = equipUpgradeQuote('h2')!
    expect(cost.safe).toBe(true)
    roll('fail')
    expect(upgradeEquipment('h2')).toBe('fail')
    expect(useInventoryStore().findItem('h2')!.level).toBe(UPGRADE_SAFE_STEP)
    expect(useUiStore().toasts.at(-1)?.text).toContain('保级')
  })

  it('到顶:返回 blocked、level 不动、分文不扣', () => {
    seat(mk('a', equipLevelCap()))
    rich()
    const r = useResourcesStore()
    const d0 = r.dust
    const s0 = { ...r.spiritStone }
    expect(upgradeEquipment('a')).toBe('blocked')
    expect(useInventoryStore().findItem('a')!.level).toBe(equipLevelCap())
    expect(r.dust).toBe(d0)
    expect(r.spiritStone).toEqual(s0)
  })

  it('未知 uid:返回 blocked、无副作用', () => {
    rich()
    const r = useResourcesStore()
    const d0 = r.dust
    expect(upgradeEquipment('ghost')).toBe('blocked')
    expect(r.dust).toBe(d0)
  })

  it('器灵尘不足:不扣、level 不动', () => {
    seat(mk('a', 0))
    const cost = costOf(0)
    const r = useResourcesStore()
    r.dust = cost.dust - 1 // 差 1 尘
    r.spiritStone = gn(1e30)
    usePlayerStore().exp = gn(1e30)
    const d0 = r.dust
    expect(upgradeEquipment('a')).toBe('blocked')
    expect(useInventoryStore().findItem('a')!.level).toBe(0)
    expect(r.dust).toBe(d0)
    expect(useUiStore().toasts.at(-1)?.text).toContain('尚差 1')
  })

  it('灵石不足:不扣、level 不动', () => {
    seat(mk('a', 0))
    const cost = costOf(0)
    const r = useResourcesStore()
    r.dust = 1_000_000_000
    r.spiritStone = sub(cost.stone, gn(1)) // 差 1 灵石
    usePlayerStore().exp = gn(1e30)
    const d0 = r.dust
    const s0 = { ...r.spiritStone }
    expect(upgradeEquipment('a')).toBe('blocked')
    expect(useInventoryStore().findItem('a')!.level).toBe(0)
    expect(r.dust).toBe(d0)
    expect(r.spiritStone).toEqual(s0)
    expect(useUiStore().toasts.at(-1)?.text).toContain('尚差 1')
  })

  it('修为不足:不扣、level 不动', () => {
    seat(mk('a', 0))
    const cost = costOf(0)
    const r = useResourcesStore()
    r.dust = 1_000_000_000
    r.spiritStone = gn(1e30)
    usePlayerStore().exp = sub(cost.exp, gn(1))
    const d0 = r.dust
    const s0 = { ...r.spiritStone }
    const e0 = { ...usePlayerStore().exp }
    expect(upgradeEquipment('a')).toBe('blocked')
    expect(useInventoryStore().findItem('a')!.level).toBe(0)
    expect(r.dust).toBe(d0)
    expect(r.spiritStone).toEqual(s0)
    expect(usePlayerStore().exp).toEqual(e0)
    expect(useUiStore().toasts.at(-1)?.text).toContain('修为')
  })
})
