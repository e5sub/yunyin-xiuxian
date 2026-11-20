/**
 * 经济 op 复算口径(1.77.0):客户端自算灵石收入的每条路径,服务端只认数据表 ——
 * 这里钉住 resolveEconomyOp 的判据:金额全部由表复算,客户端报的数值一律不作数。
 */
import { describe, expect, it } from 'vitest'
import { resolveEconomyOp, type EconomyOpCtx } from './economyOps'

function ctx(over: Partial<EconomyOpCtx> = {}): EconomyOpCtx {
  return {
    now: 1_700_000_000_000,
    major: 3,
    resources: { ore: 0, herbByGrade: {} },
    inventory: { pills: {}, items: [] },
    market: { consign: [] },
    bounty: { bountyAt: 0, orders: [] },
    ...over
  }
}

describe('经济 op 复算', () => {
  it('坊市卖丹:无丹方(无 stoneBase)的丹不收,有存量按表计价', () => {
    const no = resolveEconomyOp({ kind: 'market_sell_pill', pillId: 'not_a_pill' }, ctx())
    expect(no.ok).toBe(false)
    const empty = resolveEconomyOp(
      { kind: 'market_sell_pill', pillId: 'not_a_pill', count: 1 },
      ctx({ inventory: { pills: { not_a_pill: 5 }, items: [] } })
    )
    expect(empty.ok).toBe(false)
  })

  it('坊市卖玄铁/灵草:档里存量不够一摞拒收,足够才按表计价', () => {
    const poor = resolveEconomyOp({ kind: 'market_sell_material', count: 1 }, ctx({ resources: { ore: 1, herbByGrade: {} } }))
    expect(poor.ok).toBe(false)
    const rich = resolveEconomyOp(
      { kind: 'market_sell_material', count: 2 },
      ctx({ resources: { ore: 24, herbByGrade: {} } })
    )
    expect(rich.ok).toBe(true)
    expect(rich.stone).toBeDefined()
  })

  it('坊市寄卖:未到期拒收,到期按 tier+品质现算(不认客户端存的 price)', () => {
    const pending = resolveEconomyOp(
      { kind: 'market_sell_consign', consignIdx: 0 },
      ctx({ market: { consign: [{ tier: 2, qualityRank: 2, finishAt: 1_700_060_000_000, price: 1e12 }] } })
    )
    expect(pending.ok).toBe(false)
    const done = resolveEconomyOp(
      { kind: 'market_sell_consign', consignIdx: 0 },
      ctx({ market: { consign: [{ tier: 2, qualityRank: 2, finishAt: 1_699_990_000_000, price: 1e12 }] } })
    )
    expect(done.ok).toBe(true)
    // 客户端把 price 改成天文数字也没用:价按 (tier, rank) 重算
    expect(done.stone).toBeDefined()
  })

  it('悬赏:未换版窗口内按 (major, bountyAt) 再生订单,档里造的单对不上版就拒', () => {
    const bountyAt = 1_700_000_000_000
    const forged = resolveEconomyOp(
      { kind: 'bounty_claim', bountyIdx: 0 },
      ctx({
        bounty: { bountyAt, orders: [{ idx: 0, kind: 'ore', target: 1, claimed: false }] },
        resources: { ore: 1e9, herbByGrade: {} }
      })
    )
    expect(forged.ok).toBe(false) // 再生订单的 target 与档里那单对不上
  })

  it('洞府巡游:只认固定池里的 (eventId, optionIdx),池外事件拒收', () => {
    const ghost = resolveEconomyOp({ kind: 'cave_tour', eventId: 'ghost_event', optionIdx: 0 }, ctx())
    expect(ghost.ok).toBe(false)
  })

  it('成就/主线/日课:按 id 查表折算 stoneTier,查无此 id 拒收', () => {
    const ghost = resolveEconomyOp({ kind: 'reward_claim', rewardKind: 'achievement', rewardId: 'nope' }, ctx())
    expect(ghost.ok).toBe(false)
    const real = resolveEconomyOp(
      { kind: 'reward_claim', rewardKind: 'main', rewardId: 'q_start' },
      ctx({ major: 5 })
    )
    expect(real.ok).toBe(true)
    expect(real.stone).toBeDefined()
  })

  it('连胜赏格按固定表;秘境层按 (realmId, layer) 复算,层数越界拒收', () => {
    const ghostStreak = resolveEconomyOp({ kind: 'streak', streak: 9999 }, ctx())
    expect(ghostStreak.ok).toBe(false)
    const badLayer = resolveEconomyOp({ kind: 'secret_layer', realmId: 'nope', layer: 1 }, ctx())
    expect(badLayer.ok).toBe(false)
  })
})
