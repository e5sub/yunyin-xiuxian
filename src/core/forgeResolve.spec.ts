/**
 * 服务端权威炼器 —— 无头裁决链的判据(core/forgeResolve 经 server 动态加载)。
 *
 * 三处客户端掷点(强化成败、重铸词条、词条转移)收进服务端后,要守住的是:
 *   · **形状门槛**:uid 非法 / 未开局 / 次数越界一律拒绝结算,不猜;
 *   · **一件未动**:被拒时 items 与 spend 都是空的,不许「拒了但扣了」;
 *   · **账目对得上**:spend 汇总 = 实际扣掉的三样,供调用方记 pendingSpend;
 *   · **只报变更件**:回传的 items 只含真变了的那几件,客户端按 uid 覆盖。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { EquipmentInstance } from '@/types'
import { toNum } from '@/utils/gnum'
import { parseForgeOp, resolveForgeFromSlices, FORGE_TIMES_MAX } from './forgeResolve'
import { expHoldCap, holdCapOf } from './saveAuthority'

/** 天品武器:词条池最宽,重铸与转移都能跑 */
const W = 'w_hanfeng'

function mk(uid: string, level = 0, affixes: [string, number][] = []): EquipmentInstance {
  return {
    uid,
    templateId: W,
    quality: 'heaven',
    tier: 20,
    level,
    affixes: affixes.map(([id, roll]) => ({ id, roll }))
  }
}

/** 一份「钱管够、修为管够」的可结算档 */
function saveWith(items: EquipmentInstance[], equipped: Record<string, string> = {}): Record<string, unknown> {
  return {
    game: { started: true },
    player: { major: 4, sub: 0, exp: { m: 1, e: 9 } },
    resources: { spiritStone: { m: 1, e: 9 }, dust: 1_000_000, qi: 0 },
    inventory: { items, equipped, pills: {} }
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('炼器裁决 · 形状门槛', () => {
  it('uid 缺失/超长、op 不认得:parseForgeOp 返回 null', () => {
    expect(parseForgeOp(null)).toBeNull()
    expect(parseForgeOp({ op: 'upgrade' })).toBeNull()
    expect(parseForgeOp({ op: 'upgrade', uid: '' })).toBeNull()
    expect(parseForgeOp({ op: 'upgrade', uid: 'x'.repeat(65) })).toBeNull()
    expect(parseForgeOp({ op: 'nope', uid: 'e1' })).toBeNull()
    expect(parseForgeOp({ op: 'transfer', uid: 'e1' })).toBeNull()
    expect(parseForgeOp({ op: 'transfer', req: { sourceUid: 'a', targetUid: 'b', affixId: '' } })).toBeNull()
  })

  it('次数与预算一律收口,不让一次请求掷到天亮', () => {
    expect(parseForgeOp({ op: 'upgrade', uid: 'e1' })).toEqual({ op: 'upgrade', uid: 'e1', times: 1 })
    expect(parseForgeOp({ op: 'upgrade', uid: 'e1', times: 0 })).toEqual({ op: 'upgrade', uid: 'e1', times: 1 })
    expect(parseForgeOp({ op: 'upgrade', uid: 'e1', times: 1e9 })).toEqual({
      op: 'upgrade',
      uid: 'e1',
      times: FORGE_TIMES_MAX
    })
    const auto = parseForgeOp({ op: 'autoReforge', uid: 'e1', targets: [], maxRolls: 1e9 })
    expect(auto).not.toBeNull()
    expect(auto!.op === 'autoReforge' && auto!.maxRolls).toBe(500)
  })

  it('自动重铸的目标词条:野 id 丢弃、重复只留一条、minRoll 夹进 [0,1]', () => {
    const op = parseForgeOp({
      op: 'autoReforge',
      uid: 'e1',
      targets: [{ affixId: 'atk3', minRoll: 3 }, { affixId: 'atk3' }, { affixId: '不存在的词条' }],
      maxRolls: 10
    })
    expect(op).not.toBeNull()
    const targets = op!.op === 'autoReforge' ? op!.targets : []
    expect(targets).toEqual([{ affixId: 'atk3', minRoll: 1 }])
  })

  it('未开局 / 缺境界:拒绝结算', () => {
    const notStarted = saveWith([mk('e1')])
    notStarted.game = { started: false }
    expect(resolveForgeFromSlices(notStarted, { op: 'upgrade', uid: 'e1' })).toBeNull()

    const noRealm = saveWith([mk('e1')])
    delete (noRealm.player as Record<string, unknown>).major
    expect(resolveForgeFromSlices(noRealm, { op: 'upgrade', uid: 'e1' })).toBeNull()
  })

  it('查无此件:ok=false 且一件未动、一分未扣', () => {
    const res = resolveForgeFromSlices(saveWith([mk('e1')]), { op: 'upgrade', uid: 'ghost' })!
    expect(res.ok).toBe(false)
    expect(res.items).toEqual([])
    expect(res.spend.dust).toBe(0)
    expect(toNum(res.spend.stone)).toBe(0)
    expect(toNum(res.spend.exp)).toBe(0)
  })
})

describe('炼器裁决 · 强化', () => {
  it('掷中:+1 级、三样各扣一份、只回这一件', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const res = resolveForgeFromSlices(saveWith([mk('e1'), mk('e2')]), { op: 'upgrade', uid: 'e1' })!
    expect(res.ok).toBe(true)
    expect(res.detail.kind).toBe('upgrade')
    expect(res.items).toHaveLength(1)
    expect(res.items[0]!.uid).toBe('e1')
    expect(res.items[0]!.level).toBe(1)
    expect(res.spend.dust).toBeGreaterThan(0)
    expect(toNum(res.spend.stone)).toBeGreaterThan(0)
    expect(toNum(res.spend.exp)).toBeGreaterThan(0)
  })

  it('掷空:跌回保级点,但料照扣(强化的规矩:成败都要付)', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999999)
    const res = resolveForgeFromSlices(saveWith([mk('e1', 5)]), { op: 'upgrade', uid: 'e1' })!
    expect(res.ok).toBe(true)
    expect(res.detail.kind === 'upgrade' && res.detail.outcome).toBe('fail')
    expect(res.items[0]!.level).toBeLessThanOrEqual(5)
    expect(res.spend.dust).toBeGreaterThan(0)
  })

  it('连掷 N 次:一次请求掷到位,全成时正好 N 级', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const res = resolveForgeFromSlices(saveWith([mk('e1')]), { op: 'upgrade', uid: 'e1', times: 3 })!
    expect(res.ok).toBe(true)
    expect(res.detail.kind === 'upgrade' && res.detail.tries).toBe(3)
    expect(res.items[0]!.level).toBe(3)
  })

  it('连掷中途失手即停:不再往下掷', () => {
    const spy = vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValue(0.999999)
    const res = resolveForgeFromSlices(saveWith([mk('e1')]), { op: 'upgrade', uid: 'e1', times: 5 })!
    expect(res.detail.kind === 'upgrade' && res.detail.tries).toBe(2)
    // 0 级必成(rate=1),1 级失手回落到 0 级
    expect(res.items[0]!.level).toBe(0)
    spy.mockRestore()
  })

  it('云档没钱、上报也没钱:一分不扣,只回拒因', () => {
    const data = saveWith([mk('e1')])
    data.resources = { spiritStone: { m: 0, e: 0 }, dust: 0, qi: 0 }
    ;(data.player as Record<string, unknown>).exp = { m: 0, e: 0 }
    const res = resolveForgeFromSlices(data, { op: 'upgrade', uid: 'e1' })!
    expect(res.ok).toBe(false)
    expect(res.items).toEqual([])
    expect(res.spend.dust).toBe(0)
  })

  it('上报余额高于云档时按上报算:本地刚拾到的器灵尘不该被当成没有', () => {
    const data = saveWith([mk('e1')])
    data.resources = { spiritStone: { m: 0, e: 0 }, dust: 0, qi: 0 }
    ;(data.player as Record<string, unknown>).exp = { m: 0, e: 0 }
    const poor = resolveForgeFromSlices(data, { op: 'upgrade', uid: 'e1' })!
    expect(poor.ok).toBe(false)
    const rich = resolveForgeFromSlices(
      data,
      { op: 'upgrade', uid: 'e1' },
      { dust: 1_000_000, stone: { m: 1, e: 9 }, exp: { m: 1, e: 9 } }
    )!
    expect(rich.ok).toBe(true)
  })

  it('上报余额有天花板:填天数字当钱花,最多只能预支本境界的持有上限(1.66.1)', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const data = saveWith([mk('e1')])
    // 压到练气:持有上限最小,「未来资源」与真实成本差得最开
    ;(data.player as Record<string, unknown>).major = 0
    ;(data.player as Record<string, unknown>).sub = 0
    data.resources = { spiritStone: { m: 0, e: 0 }, dust: 0, qi: 0 }
    const res = resolveForgeFromSlices(data, { op: 'upgrade', uid: 'e1', times: 200 }, {
      dust: 1e12,
      stone: { m: 1, e: 30 },
      exp: { m: 1, e: 30 }
    })!
    // 采信被钳在本境界上限内:扣掉的三样都不可能超过上限
    expect(res.spend.dust).toBeLessThanOrEqual(Math.floor(holdCapOf(0, 'dust')))
    expect(toNum(res.spend.stone)).toBeLessThanOrEqual(holdCapOf(0, 'stone'))
    expect(toNum(res.spend.exp)).toBeLessThanOrEqual(toNum(expHoldCap(0, 0)))
    // 也就掷不到 200 次:余额按钳后的量算,材料一到头就停
    expect(res.detail.kind === 'upgrade' && res.detail.tries).toBeLessThan(200)
  })

  it('云档余额本身就高于上限时,不因采信上限被回压(压不压是上传裁决的活)', () => {
    const data = saveWith([mk('e1')])
    data.resources = { spiritStone: { m: 1, e: 40 }, dust: 1e12, qi: 0 }
    const res = resolveForgeFromSlices(
      data,
      { op: 'upgrade', uid: 'e1' },
      { dust: 0, stone: { m: 0, e: 0 }, exp: { m: 0, e: 0 } }
    )!
    expect(res.ok).toBe(true)
  })
})

describe('炼器裁决 · 重铸', () => {
  it('成交:词条条数落在品质区间、封存那条原样留着', () => {
    const item = mk('e1', 0, [
      ['atk3', 0.9],
      ['def3', 0.8]
    ])
    item.sealedAffixIds = ['atk3']
    const res = resolveForgeFromSlices(saveWith([item]), { op: 'reforge', uid: 'e1' })!
    expect(res.ok).toBe(true)
    const after = res.items[0]!
    expect(after.affixes.some(a => a.id === 'atk3' && a.roll === 0.9), '封存条不许动').toBe(true)
    // 至少留一个可重掷位:封存 1 条时新总数不超过上限,也不再是原来那一条
    expect(after.affixes.length).toBeGreaterThan(1)
    expect(after.reforgeCount).toBe(1)
    expect(res.spend.dust).toBeGreaterThan(0)
  })

  it('无可重铸的词条(全封存):ok=false,一件未动', () => {
    const item = mk('e1', 0, [['atk3', 0.9]])
    item.sealedAffixIds = ['atk3']
    const res = resolveForgeFromSlices(saveWith([item]), { op: 'reforge', uid: 'e1' })!
    expect(res.ok).toBe(false)
    expect(res.items).toEqual([])
  })
})

describe('炼器裁决 · 词条转移', () => {
  it('成交:源件少一条、目标件多一条,两件都回传', () => {
    const source = mk('s', 0, [
      ['atk3', 0.9],
      ['def3', 0.8]
    ])
    const target = mk('t', 0, [['hp1', 0.5]])
    const res = resolveForgeFromSlices(saveWith([source, target]), {
      op: 'transfer',
      req: { sourceUid: 's', targetUid: 't', affixId: 'atk3', replaceId: null, seal: false }
    })!
    expect(res.ok).toBe(true)
    const uids = res.items.map(it => it.uid).sort()
    expect(uids).toEqual(['s', 't'])
    expect(res.items.find(it => it.uid === 's')!.affixes.some(a => a.id === 'atk3')).toBe(false)
    expect(res.items.find(it => it.uid === 't')!.affixes.some(a => a.id === 'atk3')).toBe(true)
    expect(res.items.find(it => it.uid === 't')!.transferCount).toBe(1)
  })

  it('落位不成立:ok=false,两件都不动', () => {
    const source = mk('s', 0, [['atk3', 0.9]])
    const target = mk('t', 0, [['hp1', 0.5]])
    const res = resolveForgeFromSlices(saveWith([source, target]), {
      op: 'transfer',
      req: { sourceUid: 's', targetUid: 't', affixId: 'atk3', replaceId: '不存在', seal: false }
    })!
    expect(res.ok).toBe(false)
    expect(res.items).toEqual([])
  })
})

describe('炼器裁决 · 一键强化', () => {
  it('身上每件各掷一次,队列按部位顺序', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const data = saveWith([mk('w1'), mk('h1')], { weapon: 'w1', head: 'h1' })
    const res = resolveForgeFromSlices(data, { op: 'sweep' })!
    expect(res.ok).toBe(true)
    expect(res.detail.kind === 'sweep' && res.detail.tried).toBe(2)
    expect(res.detail.kind === 'sweep' && res.detail.ups).toBe(2)
    expect(res.items.map(it => it.level)).toEqual([1, 1])
  })

  it('身上没装备:一件都没掷,交给客户端出「皆已满级」', () => {
    const res = resolveForgeFromSlices(saveWith([mk('w1')]), { op: 'sweep' })!
    expect(res.ok).toBe(false)
    expect(res.items).toEqual([])
  })
})
