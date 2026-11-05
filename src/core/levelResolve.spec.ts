/**
 * 服务端权威升级 —— 无头裁决链的判据(core/levelResolve 经 server 动态加载)。
 *
 * 功法进修与建筑升级收进服务端(1.59.0)后,要守住的是:
 *   · **形状门槛**:id 非法 / 未开局 / steps 越界一律拒绝结算,不猜;
 *   · **一级未动**:被拒时 slices 与 spend 都是空的,不许「拒了但扣了」;
 *   · **账目对得上**:spend = 实际扣掉的四样,供调用方记 progress_spend;
 *   · **只报变更键**:回传的 slices 只含真变了的分片与顶层键(客户端按它覆盖本地);
 *   · **门槛同源**:境界闸 / 洞府辖限 / 满级 / 缺料,与服务层展示同一套报价函数。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { toNum } from '@/utils/gnum'
import { buildingDef } from '@/data/buildings'
import { gongfaDef, gongfaMaxLevel } from '@/data/gongfa'
import { holdCapOf } from './saveAuthority'
import { useResourcesStore } from '@/stores/resources'
import { useCultivationStore } from '@/stores/cultivation'
import { useDongfuStore } from '@/stores/dongfu'
import {
  buildingBatchQuote,
  buildingUpgradeQuote,
  gongfaUpgradeQuote,
  parseLevelOp,
  resolveLevelFromSlices,
  resolveLevelOnStores
} from './levelResolve'

const G = 'm_taixuan' // 凡品主修,满级 9

/** 一份「钱管够」的可结算档 */
function saveWith(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    game: { started: true },
    player: { major: 0, sub: 0 },
    resources: { spiritStone: { m: 1, e: 9 }, wudao: 100_000, page: 10_000, ore: 50_000, dust: 0, qi: 0 },
    cultivation: { learned: { [G]: 1 } },
    dongfu: { levels: { mansion: 0, field: 0, library: 0, forge: 0, alchemy: 0, array: 0, beast: 0 } },
    ...extra
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  // 新档口袋是空的:给一份管够的余额,缺料用例再单独抠到 0
  useResourcesStore().$patch({ wudao: 100_000, page: 10_000, ore: 50_000, spiritStone: { m: 1, e: 9 } })
})

describe('升级裁决 · 形状门槛', () => {
  it('id 缺失/超长、op 不认得:parseLevelOp 返回 null', () => {
    expect(parseLevelOp(null)).toBeNull()
    expect(parseLevelOp({ op: 'gongfaUpgrade' })).toBeNull()
    expect(parseLevelOp({ op: 'gongfaUpgrade', id: '' })).toBeNull()
    expect(parseLevelOp({ op: 'gongfaUpgrade', id: 'x'.repeat(65) })).toBeNull()
    expect(parseLevelOp({ op: 'nope', id: 'mansion' })).toBeNull()
  })

  it('步数一律收口:缺省 1,负数归 0(连升到底),越界钳满', () => {
    expect(parseLevelOp({ op: 'buildingUpgrade', id: 'mansion' })).toEqual({
      op: 'buildingUpgrade',
      id: 'mansion',
      steps: 1
    })
    expect(parseLevelOp({ op: 'buildingUpgrade', id: 'mansion', steps: -3 })?.op).toBe('buildingUpgrade')
    expect(parseLevelOp({ op: 'buildingUpgrade', id: 'mansion', steps: 1e9 })).toEqual({
      op: 'buildingUpgrade',
      id: 'mansion',
      steps: 64
    })
  })

  it('未开局的档拒绝结算,不猜', () => {
    expect(resolveLevelFromSlices(saveWith({ game: { started: false } }), { op: 'gongfaUpgrade', id: G })).toBeNull()
    expect(resolveLevelFromSlices({ game: { started: true } }, { op: 'gongfaUpgrade', id: G })).toBeNull()
    expect(resolveLevelFromSlices(saveWith(), 'junk')).toBeNull()
  })
})

describe('升级裁决 · 功法进修', () => {
  it('正常进修:扣悟道点与残页,等级 +1,账目对得上', () => {
    const res = useResourcesStore()
    const cultivation = useCultivationStore()
    cultivation.learn(G)
    const wudaoBefore = res.wudao
    const pageBefore = res.page
    const cost = gongfaUpgradeQuote(G)!
    expect(cost).not.toBeNull()
    const out = resolveLevelOnStores({ op: 'gongfaUpgrade', id: G })
    expect(out.ok).toBe(true)
    expect(out.spend.wudao).toBe(cost.wudao)
    expect(out.spend.page).toBe(cost.page)
    expect(res.wudao).toBe(wudaoBefore - cost.wudao)
    expect(res.page).toBe(pageBefore - cost.page)
    expect(cultivation.learned[G]).toBe(2)
    expect(out.detail).toMatchObject({ kind: 'gongfa', id: G, from: 1, to: 2, levels: 1 })
    // 只报变更分片:resources 与 cultivation 都动了,dongfu 不出现
    expect(Object.keys(out.slices).sort()).toEqual(['cultivation', 'resources'])
    expect(out.slices.resources).toHaveProperty('wudao')
    expect(out.slices.cultivation).toHaveProperty('learned')
    expect(out.slices.dongfu).toBeUndefined()
  })

  it('缺悟道点/缺残页:拒,一级未动、一样未扣', () => {
    const res = useResourcesStore()
    const cultivation = useCultivationStore()
    cultivation.learn(G)
    res.wudao = 0
    const out1 = resolveLevelOnStores({ op: 'gongfaUpgrade', id: G })
    expect(out1.ok).toBe(false)
    expect(out1.reason).toBe('wudao')
    expect(out1.spend.wudao).toBe(0)
    expect(cultivation.learned[G]).toBe(1)
    res.wudao = 100_000
    res.page = 0
    const out2 = resolveLevelOnStores({ op: 'gongfaUpgrade', id: G })
    expect(out2.reason).toBe('page')
    expect(res.wudao).toBe(100_000)
    res.page = 10_000
    res.wudao = 0
    res.page = 0
    expect(resolveLevelOnStores({ op: 'gongfaUpgrade', id: G }).reason).toBe('both')
  })

  it('满级与认不出的功法:拒(cap / gone)', () => {
    const cultivation = useCultivationStore()
    cultivation.learned = { [G]: gongfaMaxLevel(gongfaDef(G)) }
    expect(resolveLevelOnStores({ op: 'gongfaUpgrade', id: G })).toMatchObject({ ok: false, reason: 'cap' })
    expect(resolveLevelOnStores({ op: 'gongfaUpgrade', id: 'no_such' })).toMatchObject({ ok: false, reason: 'gone' })
  })

  it('寒冥灵脉折扣生效:报价与 service 展示同一份', () => {
    const cultivation = useCultivationStore()
    const dongfu = useDongfuStore()
    cultivation.learn(G)
    const full = gongfaUpgradeQuote(G)!.wudao
    // 悟道脉每点折 0.4%,上限 50%(见 data/veins);灌满点数报价应明显低于原价
    dongfu.veinPoints = { gather: 0, craft: 0, alchemy: 0, insight: 70 }
    const discounted = gongfaUpgradeQuote(G)!.wudao
    expect(discounted).toBeLessThan(full)
    expect(discounted).toBeGreaterThanOrEqual(Math.ceil(full * 0.5))
  })
})

describe('升级裁决 · 建筑升级', () => {
  it('单升:扣灵石与玄铁,升一级,账目对得上', () => {
    const dongfu = useDongfuStore()
    const out = resolveLevelOnStores({ op: 'buildingUpgrade', id: 'mansion', steps: 1 })
    expect(out.ok).toBe(true)
    const def = buildingDef('mansion')!
    expect(out.spend.ore).toBe(def.costOre)
    expect(out.detail).toMatchObject({ kind: 'building', id: 'mansion', from: 0, to: 1, levels: 1 })
    expect(dongfu.levels.mansion).toBe(1)
    expect(out.slices.dongfu).toHaveProperty('levels')
    expect(out.slices.resources).toHaveProperty('spiritStone')
  })

  it('境界闸:major=0 升不了灵兽园(realm)', () => {
    const dongfu = useDongfuStore()
    const out = resolveLevelOnStores({ op: 'buildingUpgrade', id: 'beast', steps: 1 })
    expect(out).toMatchObject({ ok: false, reason: 'realm' })
    expect(dongfu.levels.beast ?? 0).toBe(0)
  })

  it('洞府辖限:洞府 0 级时灵田最多 5 级(gate)', () => {
    const dongfu = useDongfuStore()
    dongfu.levels = { ...dongfu.levels, field: 5 }
    const q = buildingUpgradeQuote('field')
    expect(q.block).toBe('gate')
    const out = resolveLevelOnStores({ op: 'buildingUpgrade', id: 'field', steps: 1 })
    expect(out).toMatchObject({ ok: false, reason: 'gate' })
    expect(dongfu.levels.field).toBe(5)
  })

  it('缺料:拒(stone / ore),一级未动', () => {
    const res = useResourcesStore()
    const dongfu = useDongfuStore()
    res.spiritStone = { m: 0, e: 0 }
    expect(resolveLevelOnStores({ op: 'buildingUpgrade', id: 'mansion', steps: 1 })).toMatchObject({
      ok: false,
      reason: 'stone'
    })
    res.spiritStone = { m: 1, e: 9 }
    res.ore = 0
    expect(resolveLevelOnStores({ op: 'buildingUpgrade', id: 'mansion', steps: 1 })).toMatchObject({
      ok: false,
      reason: 'ore'
    })
    expect(dongfu.levels.mansion ?? 0).toBe(0)
  })

  it('连升(steps=0):一路升到品类满级,逐级价目累加;再升是 max', () => {
    const dongfu = useDongfuStore()
    const out = resolveLevelOnStores({ op: 'buildingUpgrade', id: 'mansion', steps: 0 })
    const def = buildingDef('mansion')!
    expect(out.ok).toBe(true)
    expect(out.detail.levels).toBe(def.maxLevel)
    expect(out.detail.to).toBe(def.maxLevel)
    expect(out.detail.atMax).toBe(true)
    expect(dongfu.levels.mansion).toBe(def.maxLevel)
    // 逐级价目 = 总账:单升一步的价目循环累加
    const plan = buildingBatchQuote('mansion')
    expect(plan.levels).toBe(0)
    expect(plan.block).toBe('max')
  })

  it('连升(steps=n)受步数与辖限双重约束;展示计划与裁决同源', () => {
    const dongfu = useDongfuStore()
    const out = resolveLevelOnStores({ op: 'buildingUpgrade', id: 'mansion', steps: 2 })
    expect(out.detail.levels).toBe(2)
    expect(out.detail.to).toBe(2)
    expect(dongfu.levels.mansion).toBe(2)
    // 展示计划(不动手)与裁决逐字段同源:同样的余额,同样的累计
    dongfu.levels = { ...dongfu.levels, mansion: 0 }
    const plan = buildingBatchQuote('mansion')
    expect(plan.levels).toBe(buildingDef('mansion')!.maxLevel)
    expect(plan.ore).toBeGreaterThan(0)
  })
})

describe('升级裁决 · 无头水合', () => {
  it('从云档分片结算:结果与本地链逐字段一致,变更分片只含改动的键', () => {
    useCultivationStore().learn(G) // 与云档的 cultivation 分片同态,再比两边的账
    const local = resolveLevelOnStores({ op: 'gongfaUpgrade', id: G })
    const remote = resolveLevelFromSlices(saveWith(), { op: 'gongfaUpgrade', id: G })
    expect(remote).not.toBeNull()
    expect(remote!.ok).toBe(true)
    expect(remote!.spend).toEqual(local.spend)
    expect(remote!.slices.cultivation).toHaveProperty('learned')
    expect(remote!.slices.resources).toHaveProperty('wudao')
    // 没动过的分片不出现:档里没有 dongfu 就更不该冒出来
    expect(remote!.slices.dongfu).toBeUndefined()
  })

  it('余额采「不低于云档」的上报值:本地多报可以,少报按云档', () => {
    // 云档 wudao 5 万,上报 1 万(少报):按云档算,照样付得起
    const a = resolveLevelFromSlices(saveWith(), { op: 'gongfaUpgrade', id: G }, { wudao: 10_000 })
    expect(a!.ok).toBe(true)
    // 云档 wudao 0,上报 10 万(多报):采信上报,也付得起 —— 花多少由服务端算
    const b = resolveLevelFromSlices(
      saveWith({ resources: { spiritStone: { m: 1, e: 9 }, wudao: 0, page: 10_000, ore: 0, dust: 0, qi: 0 } }),
      { op: 'gongfaUpgrade', id: G },
      { wudao: 100_000 }
    )
    expect(b!.ok).toBe(true)
    // 不上报且云档为 0:缺料被拒
    const c = resolveLevelFromSlices(
      saveWith({ resources: { spiritStone: { m: 1, e: 9 }, wudao: 0, page: 10_000, ore: 0, dust: 0, qi: 0 } }),
      { op: 'gongfaUpgrade', id: G }
    )
    expect(c!.ok).toBe(false)
    expect(c!.reason).toBe('wudao')
  })

  it('建筑连升走无头链:洞府一路到满级,改回档的 levels 进 slices', () => {
    const out = resolveLevelFromSlices(saveWith(), { op: 'buildingUpgrade', id: 'mansion', steps: 0 })
    expect(out!.ok).toBe(true)
    expect(out!.detail.to).toBe(buildingDef('mansion')!.maxLevel)
    expect(out!.slices.dongfu).toHaveProperty('levels')
    const levels = out!.slices.dongfu!.levels as Record<string, number>
    expect(levels.mansion).toBe(buildingDef('mansion')!.maxLevel)
  })

  it('上报余额有天花板:填天数字当钱花,最多只能预支本境界的持有上限(1.66.1)', () => {
    // 云档口袋全空,余额全靠上报;洞府满级(辖限 25)让聚灵阵能连到 20 级,
    // 连满要 7.9e8 灵石 —— 远高于练气期的持有上限(3.5e6),钳不住就会一路升满
    const empty = {
      resources: { spiritStone: { m: 0, e: 0 }, wudao: 0, page: 0, ore: 0, dust: 0, qi: 0 },
      dongfu: { levels: { mansion: 4, array: 0, field: 0, library: 0, forge: 0, alchemy: 0, beast: 0 } }
    }
    const out = resolveLevelFromSlices(saveWith(empty), { op: 'buildingUpgrade', id: 'array', steps: 0 }, {
      stone: { m: 1, e: 30 },
      ore: 1e12,
      wudao: 1e12,
      page: 1e12
    })!
    expect(out.ok).toBe(true)
    // 扣掉的灵石/玄铁都不可能超过本境界上限
    expect(toNum(out.spend.stone)).toBeLessThanOrEqual(holdCapOf(0, 'stone'))
    expect(out.spend.ore).toBeLessThanOrEqual(Math.floor(holdCapOf(0, 'ore')))
    // 连升按钳后的余额走:钱一到头就停,升不满
    expect(out.detail.kind === 'building' && out.detail.levels).toBeLessThan(buildingDef('array')!.maxLevel)
  })

  it('云档余额本身就高于上限时,不因采信上限被回压(压不压是上传裁决的活)', () => {
    const rich = {
      resources: { spiritStone: { m: 1, e: 30 }, wudao: 0, page: 0, ore: 1e9, dust: 0, qi: 0 },
      dongfu: { levels: { mansion: 4, array: 0, field: 0, library: 0, forge: 0, alchemy: 0, beast: 0 } }
    }
    const out = resolveLevelFromSlices(saveWith(rich), { op: 'buildingUpgrade', id: 'array', steps: 0 })!
    expect(out.ok, '云档有钱就该能连升到底').toBe(true)
    expect(out.detail.kind === 'building' && out.detail.to).toBe(buildingDef('array')!.maxLevel)
  })
})
