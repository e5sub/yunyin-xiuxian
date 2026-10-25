/**
 * 建筑连升批量账:buildingBatchPlan 只算不动手(级数受品类满级 / 洞府辖限 / 余额约束,判据与 buildingUpgradeInfo 同源);
 * upgradeBuildingBatch 按计划一次升到位,0 级计划不扣费。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { add, gn, sub, toNum } from '@/utils/gnum'
import { buildingCost } from './formulas'
import { track } from './progress'
import { buildingBatchPlan, buildingUpgradePreview, upgradeBuildingBatch } from './buildingService'
import { usePlayerStore } from '@/stores/player'
import { useDongfuStore } from '@/stores/dongfu'
import { useResourcesStore } from '@/stores/resources'
import { useQuestsStore } from '@/stores/quests'
import { buildingDef } from '@/data/buildings'

/** 聚灵阵:costBase 60 / 玄铁 6 / 上限 20 / 炼气即开 */
const ARRAY = buildingDef('array')!

function fund(stone: number, ore = 0): void {
  const r = useResourcesStore()
  r.spiritStone = gn(stone)
  r.ore = ore
}

function seat(major: number, mansion: number): void {
  usePlayerStore().major = major
  useDongfuStore().levels = { ...useDongfuStore().levels, mansion }
}

/** 第 lv 级单次成本,与 service 同式 */
function costOf(lv: number): { stone: ReturnType<typeof buildingCost>; ore: number } {
  return { stone: buildingCost(ARRAY.costBase, lv), ore: ARRAY.costOre * (lv + 1) }
}

/** 从第 from 级起共 n 级的花费累计 */
function sumUpTo(from: number, n: number): { stone: ReturnType<typeof buildingCost>; ore: number } {
  let stone = gn(0)
  let ore = 0
  for (let i = from; i < from + n; i += 1) {
    stone = add(stone, costOf(i).stone)
    ore += costOf(i).ore
  }
  return { stone, ore }
}

describe('建筑连升 · 批量账', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    seat(1, 0) // 炼气、洞府 0 级 → 其余建筑辖限 = (0+1)*5 = 5
    fund(1e12, 1e9)
  })

  it('计划只算不动手:到辖限停(洞府 0 级时聚灵阵只能到 5),花费=各级之和、资源分文未动', () => {
    const before = useResourcesStore().spiritStone
    const plan = buildingBatchPlan('array')
    expect(plan.levels).toBe(5) // min(品类 20, 辖限 5)
    const tot = sumUpTo(0, 5)
    expect(plan.stone).toEqual(tot.stone)
    expect(plan.ore).toBe(tot.ore)
    expect(useResourcesStore().spiritStone).toEqual(before)
  })

  it('洞府自身不受辖限:是它抬别人的档,自己只顶到品类满级 4', () => {
    const plan = buildingBatchPlan('mansion')
    expect(plan.levels).toBe(buildingDef('mansion')!.maxLevel)
    expect(plan.atMax).toBe(true)
  })

  it('洞府抬档:1 级时辖限=10,聚灵阵最多连升到 10;3 级时辖限=20 摸品类上限', () => {
    seat(1, 1)
    expect(buildingBatchPlan('array').levels).toBe(10)
    seat(1, 3)
    const plan = buildingBatchPlan('array')
    expect(plan.levels).toBe(20)
    expect(plan.atMax).toBe(true)
  })

  it('玄铁封顶:只够三层的铁就只升三层,差一块则只升两层(余额限制,不到辖限)', () => {
    const t3 = sumUpTo(0, 3)
    fund(1e12, t3.ore)
    expect(buildingBatchPlan('array').levels).toBe(3)
    fund(1e12, t3.ore - 1)
    expect(buildingBatchPlan('array').levels).toBe(2)
  })

  it('一级都升不起时:拒因点名缺哪一样并给出实际差额', () => {
    const first = costOf(0)
    fund(0, first.ore)
    expect(buildingBatchPlan('array').blocked).toMatch(/^灵石尚差 [^·]+$/)

    fund(toNum(first.stone) * 2, Math.max(0, first.ore - 2))
    expect(buildingBatchPlan('array').blocked).toBe('玄铁尚差 2 块')
  })

  it('境界闸:未至对应境(0 级连升)带拒因,一升不动', () => {
    seat(0, 0) // 锻器需要筑基
    const plan = buildingBatchPlan('forge')
    expect(plan.levels).toBe(0)
    expect(plan.blocked).toContain('筑基')
  })

  it('至品类满级:0 级计划带圆满拒因', () => {
    useDongfuStore().setLevel('array', 20)
    const plan = buildingBatchPlan('array')
    expect(plan.levels).toBe(0)
    expect(plan.blocked).toContain('圆满')
    expect(plan.atMax).toBe(true)
  })

  it('连升按计划一次到位:等级升到计划数、扣费与计划一致、报实际级', () => {
    // 首次 track 会把可达成的成就/主线/日课奖励一起入账,期初须记在其后
    track('buildingUpgrades', 500) // 带过全部阈值,a_bd10/a_bd40 全发
    const before = useResourcesStore().spiritStone
    const plan = buildingBatchPlan('array')
    const n = upgradeBuildingBatch('array')
    expect(n).toBe(plan.levels)
    expect(useDongfuStore().levels.array).toBe(plan.levels)
    // 期初减期末有 ~1e-4 石浮点尾差(~1e12 端点相减),只断言到显示粒度
    expect(toNum(sub(before, useResourcesStore().spiritStone))).toBeCloseTo(toNum(plan.stone), 2)
    expect(useResourcesStore().ore).toBe(1e9 - plan.ore)
  })

  it('连升一次计 N 次营建:成就/主线的「累计升级建筑」按实际级数记账,不按批数', () => {
    track('buildingUpgrades', 100) // 先发走一次性阈值
    const plan = buildingBatchPlan('array')
    upgradeBuildingBatch('array')
    expect(useQuestsStore().counter('buildingUpgrades')).toBe(100 + plan.levels)
  })

  it('一升都升不动(境界闸)时:返回 0,分文不扣、等级不动', () => {
    seat(0, 0)
    const n = upgradeBuildingBatch('forge')
    expect(n).toBe(0)
    expect(useDongfuStore().levels.forge).toBe(0)
    expect(useResourcesStore().ore).toBe(1e9)
  })

  /** 批量预览从当前级直接 diff 到目标级(effectText 是累计值),与单步共用「只报会变的行」 */
  it('连升整段预览:从当前级直接 diff 到目标级,报累积净得', () => {
    const def = buildingDef('mansion')!
    const linesOf = (level: number): string[] =>
      def.effectText(level).split(/[;；]/).map(line => line.trim()).filter(Boolean)
    // 0→2:当前效果为空表,即整张 2 级效果
    const two = buildingUpgradePreview('mansion', 0, undefined, 2)
    expect(two.nextLevel).toBe(2)
    expect(two.lines).toEqual(linesOf(2))
    const prev = buildingUpgradePreview('mansion', 1, undefined, 2)
    expect(prev.nextLevel).toBe(3)
    const cur = linesOf(1)
    const to = linesOf(3)
    expect(prev.lines).toEqual(to.filter((line, i) => line !== cur[i]))
    expect(buildingUpgradePreview('mansion', 1, undefined, 1).lines).toEqual(
      buildingUpgradePreview('mansion', 1).lines
    )
    // 越过上限:预览为空
    expect(buildingUpgradePreview('mansion', 3, undefined, 5).lines).toEqual([])
  })
})
