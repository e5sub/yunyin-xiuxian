/**
 * 动作结算的服务端权威链 —— 判据(src/core/actionOps 经 server/vendor 动态加载)。
 *
 * 服务端拿云档分片无头水合 17 片,跑**客户端同一份结算代码**,只把改动的顶层键回传。
 * 判据四件事:
 *   · 形状门槛(未开局 / 缺境界 / 时间非法)返回 null,调用方据此拒绝;
 *   · 动作本身失败(囊中无此丹)返回 ok=false **且空补丁** —— 客户端那次预测须整体作废;
 *   · 成功的动作,补丁里必须真的带上被改的键(否则客户端不知道要覆盖什么);
 *   · 补丁不含「水合噪声」:什么都没做的键不该出现在补丁里。
 */
import { describe, expect, it, vi } from 'vitest'

const mockRand = 0.5
vi.mock('@/utils/random', async importOriginal => {
  const mod = await importOriginal<typeof import('@/utils/random')>()
  return { ...mod, rng: new mod.RandomService(() => mockRand) }
})

import { resolveActionFromSlices } from './actionOps'
import { toNum } from '@/utils/gnum'

const NOW = 1_700_000_000_000

/** 一份「炼气一层、囊中两枚聚气丹、百枚玄铁」的最小档;缺的分片按 store 默认值水合 */
function save(): Record<string, unknown> {
  return {
    game: { started: true, totalPlaySec: 600, lastActiveAt: NOW - 10_000 },
    player: { major: 0, sub: 0, exp: { m: 0, e: 0 }, age: 16, dead: false },
    resources: {
      spiritStone: { m: 1, e: 4 },
      qi: 10,
      ore: 100,
      page: 0,
      dust: 0,
      wudao: 0,
      herbByGrade: { 1: 100, 2: 0, 3: 0, 4: 0, 5: 0 }
    },
    inventory: { pills: { p_jvqidan: 2 }, items: [] },
    endgame: { daoSource: 0 }
  }
}

describe('动作结算 · 形状门槛', () => {
  it('未开局 / 缺境界 / 时刻非法:返回 null(服务端事故,不是玩家反馈)', async () => {
    const notStarted = save()
    notStarted.game = { started: false }
    await expect(resolveActionFromSlices(notStarted, { kind: 'pill_use', id: 'p_jvqidan' }, { now: NOW })).resolves.toBeNull()

    const noRealm = save()
    delete (noRealm.player as Record<string, unknown>).major
    await expect(resolveActionFromSlices(noRealm, { kind: 'pill_use', id: 'p_jvqidan' }, { now: NOW })).resolves.toBeNull()

    await expect(resolveActionFromSlices(save(), { kind: 'pill_use' }, { now: 0 })).resolves.toBeNull()
  })

  it('未知动作:ok=false 且空补丁', async () => {
    const r = await resolveActionFromSlices(save(), { kind: 'not_a_kind' }, { now: NOW })
    expect(r).not.toBeNull()
    expect(r!.ok).toBe(false)
    expect(r!.patches).toEqual({})
  })
})

describe('动作结算 · 丹药', () => {
  it('服一枚聚气丹:修为涨、丹少一枚,补丁带上这两处', async () => {
    const r = await resolveActionFromSlices(save(), { kind: 'pill_use', id: 'p_jvqidan' }, { now: NOW })
    expect(r!.ok).toBe(true)
    const pills = r!.patches.inventory?.pills as Record<string, number> | undefined
    expect(pills, '补丁要带行囊').toBeDefined()
    expect(pills!.p_jvqidan).toBe(1)
    const exp = r!.patches.player?.exp as { m: number; e: number } | undefined
    expect(exp, '补丁要带修为').toBeDefined()
    expect(toNum(exp!)).toBeGreaterThan(0)
  })

  it('囊中无此丹:ok=false,一处补丁都不回(客户端预测整体作废)', async () => {
    const empty = save()
    empty.inventory = { pills: {}, items: [] }
    const r = await resolveActionFromSlices(empty, { kind: 'pill_use', id: 'p_jvqidan' }, { now: NOW })
    expect(r!.ok).toBe(false)
    expect(r!.patches).toEqual({})
    expect(typeof r!.reason).toBe('string')
  })

  it('连服两枚:按枚数一次结清(count 不采信超出持有)', async () => {
    const r = await resolveActionFromSlices(save(), { kind: 'pill_use', id: 'p_jvqidan', count: 2 }, { now: NOW })
    expect(r!.ok).toBe(true)
    const pills = r!.patches.inventory?.pills as Record<string, number> | undefined
    // 两枚吃光:store 在归零时会删键,补丁里看到的要么是 0 要么是缺键
    expect(pills?.p_jvqidan ?? 0).toBe(0)
  })
})

describe('动作结算 · 坊市与资源', () => {
  it('卖一份玄铁:灵石涨、玄铁少,补丁两处都在', async () => {
    const r = await resolveActionFromSlices(save(), { kind: 'sell_material' }, { now: NOW })
    expect(r!.ok).toBe(true)
    const ore = r!.patches.resources?.ore as number | undefined
    expect(ore, '玄铁要被扣').toBeDefined()
    expect(ore!).toBeLessThan(100)
    const stone = r!.patches.resources?.spiritStone as { m: number; e: number } | undefined
    expect(stone, '灵石要入账').toBeDefined()
    expect(toNum(stone!)).toBeGreaterThan(1e4)
  })

  it('没有可卖之物时 ok=false', async () => {
    const broke = save()
    ;(broke.resources as Record<string, unknown>).ore = 0
    const r = await resolveActionFromSlices(broke, { kind: 'sell_material' }, { now: NOW })
    expect(r!.ok).toBe(false)
    expect(r!.patches).toEqual({})
  })

  it('卖灵草:品阶是数字,服务端须按数字取档(1.79.4 卖不出去)', async () => {
    // 客户端 reportAction('sell_herb',{grade:1}) 传的是数字 1,不是字符串 '1'
    const r = await resolveActionFromSlices(save(), { kind: 'sell_herb', grade: 1 }, { now: NOW })
    expect(r!.ok).toBe(true)
    const herb = r!.patches.resources?.herbByGrade as Record<number, number> | undefined
    expect(herb?.[1], '一阶灵草要被扣').toBeLessThan(100)
    expect(toNum(r!.patches.resources!.spiritStone as { m: number; e: number })).toBeGreaterThan(1e4)
  })

  it('卖灵草品阶非法(字符串/越界):ok=false', async () => {
    expect((await resolveActionFromSlices(save(), { kind: 'sell_herb', grade: '1' }, { now: NOW }))!.ok).toBe(false)
    expect((await resolveActionFromSlices(save(), { kind: 'sell_herb', grade: 9 }, { now: NOW }))!.ok).toBe(false)
  })
})

describe('动作结算 · 补丁不含噪声', () => {
  it('卖玄铁的补丁里不该出现与动作无关的分片', async () => {
    const r = await resolveActionFromSlices(save(), { kind: 'sell_material' }, { now: NOW })
    const slices = Object.keys(r!.patches)
    /*
     * 坊市卖出只动资源;行囊/角色不该被这次动作改写。
     * `quests` 例外:1.79.0 起动作结算末尾会补扫一次成就,卖出一笔刚好凑够某个成就时
     * 那一行就落在 quests 分片里 —— 那是真改动,不是噪声。
     */
    expect(slices.filter(s => s !== 'quests')).toEqual(['resources'])
  })
})

/*
 * 1.79.0:在场浮窗、转世交割单、坊市买入都搬上了服务端。
 * 这一组判据盯的是「搬上去之后,那些东西还认得出、算得对」——
 * 事件本体已进 player 分片,所以无头水合就能复现同一扇窗。
 */
describe('动作结算 · 在场浮窗(1.79.0 事件进档)', () => {
  /** 一扇还开着的顿悟窗:expiresAt 按墙钟取,否则 gameNow() 一读就判过期 */
  function withEnlightenment(): Record<string, unknown> {
    const data = save()
    const at = Date.now()
    ;(data.player as Record<string, unknown>).earlyEvents = {
      enlightenment: {
        id: `enlighten_${at}`,
        options: [
          { type: 'insight', label: '悟道', desc: '悟道点 +5', duration: 0, reward: { type: 'wudao', value: 5 } }
        ],
        triggeredAt: at - 1000,
        expiresAt: at + 59_000
      },
      cave: null
    }
    return data
  }

  it('选一扇开着的窗:补丁带悟道点,并且把窗关掉', async () => {
    const data = withEnlightenment()
    const r = await resolveActionFromSlices(data, { kind: 'enlighten', index: 0 }, { now: Date.now() })
    expect(r!.ok).toBe(true)
    expect((r!.patches.resources?.wudao as number | undefined)).toBe(5)
    const ee = r!.patches.player?.earlyEvents as { enlightenment: unknown } | undefined
    expect(ee, '窗没被关掉,客户端会一直弹').toBeDefined()
    expect(ee!.enlightenment).toBeNull()
  })

  it('没有窗时 ok=false 且空补丁', async () => {
    const r = await resolveActionFromSlices(save(), { kind: 'enlighten', index: 0 }, { now: Date.now() })
    expect(r!.ok).toBe(false)
    expect(r!.patches).toEqual({})
  })
})

describe('动作结算 · 转世交割单(1.79.0 服务端算)', () => {
  it('准备 → 确认:世号 +1,交割单当场作废', async () => {
    const prepared = await resolveActionFromSlices(save(), { kind: 'rebirth_prepare' }, { now: NOW })
    expect(prepared!.ok).toBe(true)
    const offer = prepared!.patches.player?.rebirthOffer as Record<string, unknown> | undefined
    expect(offer, '交割单没进补丁,客户端就没得画').toBeDefined()
    expect(Array.isArray(offer!.talentChoices)).toBe(true)

    // 下一拍:云端档里已经有这张单子了
    const data = save()
    ;(data.player as Record<string, unknown>).rebirthOffer = offer
    const done = await resolveActionFromSlices(data, { kind: 'rebirth_confirm', id: '' }, { now: NOW })
    expect(done!.ok).toBe(true)
    const count = (done!.patches.player?.reincarnation as { count: number } | undefined)?.count
    expect(count, '世号没涨').toBe(1)
    expect(done!.patches.player?.rebirthOffer, '交割单没被取走,连点能兑两次').toBeNull()
  })

  it('没有交割单时确认:ok=false(客户端凭空的单子不认)', async () => {
    const r = await resolveActionFromSlices(save(), { kind: 'rebirth_confirm', id: '' }, { now: NOW })
    expect(r!.ok).toBe(false)
  })
})

describe('动作结算 · 坊市买入(1.79.0 服务端执行)', () => {
  it('过旧/未来的货架时刻:ok=false(防挑种子/未来钟)', async () => {
    // 时间窗判据用真实时钟,故这里也用真实 Date.now() 构造越界值
    const now = Date.now()
    expect((await resolveActionFromSlices(save(), { kind: 'market_buy', at: 1, index: 0 }, { now }))!.ok).toBe(false)
    expect(
      (await resolveActionFromSlices(save(), { kind: 'market_buy', at: now + 5 * 60_000, index: 0 }, { now }))!.ok
    ).toBe(false)
  })

  it('缺货架时刻或越界格号:ok=false', async () => {
    const now = Date.now()
    expect((await resolveActionFromSlices(save(), { kind: 'market_buy', index: 0 }, { now }))!.ok).toBe(false)
    expect((await resolveActionFromSlices(save(), { kind: 'market_buy', at: now, index: 99 }, { now }))!.ok).toBe(
      false
    )
  })

  it('云档起钟远旧于本地:按本地 at 重上货架成交,起钟追平(1.79.4 买一次刷一次)', async () => {
    const now = Date.now()
    const at = now - 1000
    const d = save()
    // 云档起钟停在首传那一刻(10 小时前),且无货 —— 1.78 后心跳不推进 market 分片
    ;(d.market as Record<string, unknown>) = { stockedAt: now - 10 * 3_600_000, stock: [], consign: [] }
    const r = await resolveActionFromSlices(d, { kind: 'market_buy', at, index: 0 }, { now })
    expect(r!.ok).toBe(true)
    // 补丁把云档起钟追平到本地 at,不再与本地分叉(否则 resync 打回→定时器再 sync→循环刷架)
    expect((r!.patches.market as Record<string, unknown>).stockedAt).toBe(at)
    // 成交格必须带上 sold 回补丁:否则刷新后货架仍是「可买」,同一单会被反复成交
    const patchedStock = (r!.patches.market as Record<string, unknown>).stock as Array<{ sold?: boolean }> | undefined
    expect(patchedStock?.some(s => s.sold === true)).toBe(true)
  })

  it('同一架连买两格:前一格的已售标记不被后一单冲掉(1.79.6)', async () => {
    const now = Date.now()
    const at = now - 1000
    const d = save()
    // 云档已有这一架货,第 0 格已售 —— hydrate 会把它带进临时 store
    const cloudStock: Array<Record<string, unknown>> = [
      { kind: 'pill', idx: 0, pillId: 'p_jvqidan', count: 1, price: { m: 1, e: 3 }, sold: true },
      { kind: 'pill', idx: 1, pillId: 'p_jvqidan', count: 1, price: { m: 1, e: 3 }, sold: false }
    ]
    ;(d.market as Record<string, unknown>) = { stockedAt: at, stock: cloudStock, consign: [] }
    // 买第 1 格:上报的 at 与云档起钟相同(同一架)
    const r = await resolveActionFromSlices(d, { kind: 'market_buy', at, index: 1 }, { now })
    expect(r!.ok).toBe(true)
    const patchedStock = (r!.patches.market as Record<string, unknown>).stock as Array<{ idx: number; sold?: boolean }> | undefined
    // 第 1 格新售出
    expect(patchedStock?.find(s => s.idx === 1)?.sold).toBe(true)
    // 第 0 格先前已售,不能被整架重置冲回「可买」
    expect(patchedStock?.find(s => s.idx === 0)?.sold).toBe(true)
  })
})

describe('动作结算 · 差事收割(1.79.0 产出由服务端算)', () => {
  /** 一名带着「已完工采药差事」的道童 */
  function withDoneTask(): Record<string, unknown> {
    const data = save()
    const now = Date.now()
    ;(data.apprentice as Record<string, unknown>) = {
      apprentices: [
        { uid: 'apt_1', archId: 'ap_luanniao', level: 3, bond: 0, task: { spec: 'herb', startAt: now - 60_000, finishAt: now - 1000 } }
      ]
    }
    return data
  }

  it('完工即收:产出入账、道童进阶、任务清空', async () => {
    const r = await resolveActionFromSlices(withDoneTask(), { kind: 'apprentice_claim', id: 'apt_1' }, { now: Date.now() })
    expect(r!.ok).toBe(true)
    const payload = r!.payload as { spoils?: { herb?: number } }
    expect(payload.spoils, '产出没算出来').toBeDefined()
    const list = r!.patches.apprentice?.apprentices as Array<{ level: number; task: unknown }> | undefined
    expect(list, '道童分片没回补丁').toBeDefined()
    expect(list![0]!.task, '任务没清,会反复收').toBeNull()
    expect(list![0]!.level, '没进阶').toBe(4)
  })

  it('尚在差中:回 remainMs,不动账', async () => {
    const data = save()
    const now = Date.now()
    ;(data.apprentice as Record<string, unknown>) = {
      apprentices: [
        { uid: 'apt_1', archId: 'ap_luanniao', level: 3, bond: 0, task: { spec: 'herb', startAt: now, finishAt: now + 10_000 } }
      ]
    }
    const r = await resolveActionFromSlices(data, { kind: 'apprentice_claim', id: 'apt_1' }, { now })
    expect(r!.ok).toBe(true)
    expect((r!.payload as { remainMs?: number }).remainMs).toBeGreaterThan(0)
    expect(r!.patches.apprentice).toBeUndefined()
  })

  it('查无此单:回 gone(不白拿产出)', async () => {
    const r = await resolveActionFromSlices(save(), { kind: 'apprentice_claim', id: 'nope' }, { now: Date.now() })
    expect(r!.ok).toBe(true)
    expect((r!.payload as { gone?: boolean }).gone).toBe(true)
  })
})

describe('动作结算 · 装配同步(equip_set · 1.79.7)', () => {
  it('整图装配:合法件落位,补丁带上 inventory.equipped', async () => {
    const data = save()
    ;(data.inventory as Record<string, unknown>).items = [
      { uid: 'w1', templateId: 'b_qingyun', quality: 'mortal', tier: 3, level: 0, affixes: [] },
      { uid: 'h1', templateId: 'b_qingyun', quality: 'mortal', tier: 3, level: 0, affixes: [] }
    ]
    const r = await resolveActionFromSlices(
      data,
      { kind: 'equip_set', equipped: { weapon: 'w1', head: 'h1' } },
      { now: NOW }
    )
    expect(r!.ok).toBe(true)
    const equipped = r!.patches.inventory?.equipped as Record<string, string> | undefined
    expect(equipped, '补丁要带整张装配映射').toBeDefined()
    expect(equipped!.weapon).toBe('w1')
    expect(equipped!.head).toBe('h1')
  })

  it('非法件(未持有/境界不够)被丢,不污染云档装配', async () => {
    const data = save()
    ;(data.inventory as Record<string, unknown>).items = [
      { uid: 'w1', templateId: 'b_qingyun', quality: 'mortal', tier: 3, level: 0, affixes: [] },
      { uid: 'hi', templateId: 'w_hunyuan', quality: 'fine', tier: 40, level: 0, affixes: [] }
    ]
    const r = await resolveActionFromSlices(
      data,
      { kind: 'equip_set', equipped: { weapon: 'w1', head: 'ghost', body: 'hi' } },
      { now: NOW }
    )
    expect(r!.ok).toBe(true)
    const equipped = r!.patches.inventory?.equipped as Record<string, string> | undefined
    expect(equipped!.weapon).toBe('w1')
    expect(equipped!.head).toBeUndefined()
    expect(equipped!.body, '境界不够的顶阶件不该落位').toBeUndefined()
  })
})
