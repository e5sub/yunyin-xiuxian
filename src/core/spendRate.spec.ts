/**
 * VIP 修行开销九折 —— 判据。
 *
 * 要守住的三条:
 *   · **只在成本上折**:价签、缺口判据、结算、服务端记账读同一个数,不许「显示九折、扣全款」;
 *   · **到期即停**:判据是惰性读的,不缓存布尔 —— 拿 resolver 翻一下就必须回到全价;
 *   · **买卖不折**:坊市(含回收)与任务上交是物物交换,折了就是一条「九折买、原价卖」的套利。
 */
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { EquipmentInstance } from '@/types'
import { gn, mulN, toNum } from '@/utils/gnum'
import { useInventoryStore } from '@/stores/inventory'
import { usePlayerStore } from '@/stores/player'
import { useResourcesStore } from '@/stores/resources'
import { useCultivationStore } from '@/stores/cultivation'
import { equipUpgradeQuote, upgradeBatchPlan } from './forge'
import { marketPayPrice } from './marketService'
import { buildingUpgradeQuote, gongfaUpgradeQuote, resolveLevelFromSlices } from './levelResolve'
import { upgradeCost } from './formulas'
import { cutCount, cutGNum, VIP_SPEND_RATE, setVipResolver, spendRate } from './spendRate'

function vip(on: boolean): void {
  setVipResolver(() => on)
}

function mk(uid: string, level: number): EquipmentInstance {
  return { uid, templateId: 'b_qingyun', quality: 'mortal', tier: 3, level, affixes: [] }
}

const G = 'm_taixuan'

/** 一份「钱管够」的可结算档(与服务端夹具同形) */
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
  setVipResolver(null)
  useResourcesStore().$patch({ wudao: 100_000, page: 10_000, ore: 50_000, dust: 1_000_000, spiritStone: gn(1e9) })
  usePlayerStore().exp = gn(1e9)
})

describe('折算口径', () => {
  it('未注入即原价:纯账层与既有 spec 不必先开一张月卡', () => {
    expect(spendRate()).toBe(1)
    expect(cutGNum(gn(1000))).toEqual(gn(1000))
    expect(cutCount(10)).toBe(10)
  })

  it('有效期内九折:灵石按尾数乘,件数向上取整', () => {
    vip(true)
    expect(spendRate()).toBe(VIP_SPEND_RATE)
    expect(toNum(cutGNum(gn(1000)))).toBe(900)
    expect(cutCount(10)).toBe(9)
  })

  it('小额不白送:3 株草九折仍是 3 株,1 件仍是 1 件', () => {
    vip(true)
    expect(cutCount(3), '2.7 向上取整').toBe(3)
    expect(cutCount(1)).toBe(1)
    expect(cutCount(0)).toBe(0)
  })

  it('到期即停:resolver 翻回 false 就恢复全价(不缓存布尔)', () => {
    let live = true
    setVipResolver(() => live)
    expect(toNum(cutGNum(gn(1000)))).toBe(900)
    live = false
    expect(toNum(cutGNum(gn(1000)))).toBe(1000)
  })

  it('判据自己抛错时按原价走,不把整条结算带崩', () => {
    setVipResolver(() => {
      throw new Error('auth 未就绪')
    })
    expect(spendRate()).toBe(1)
    expect(cutCount(10)).toBe(10)
  })
})

describe('价签与结算同源', () => {
  it('强化报价:尘 / 石 / 修为三样一起降,不是只降灵石', () => {
    useInventoryStore().items = [mk('e1', 0)]
    const base = equipUpgradeQuote('e1')!
    vip(true)
    const cut = equipUpgradeQuote('e1')!
    const raw = upgradeCost(0, 3, 0, 0)
    expect(base.dust, '未开 VIP 时就是原价').toBe(raw.dust)
    expect(cut.dust).toBe(cutCount(raw.dust))
    expect(toNum(cut.stone)).toBe(toNum(mulN(raw.stone, VIP_SPEND_RATE)))
    expect(toNum(cut.exp)).toBe(toNum(mulN(raw.exp, VIP_SPEND_RATE)))
  })

  it('连强计划与单强报价同口径:首级成本对得上,不会一路按全价累加', () => {
    useInventoryStore().items = [mk('e1', 0)]
    vip(true)
    const quote = equipUpgradeQuote('e1')!
    const plan = upgradeBatchPlan('e1')
    expect(plan.attempts).toBeGreaterThan(0)
    expect(plan.dust).toBeGreaterThanOrEqual(quote.dust)
  })

  it('建筑报价:灵石与玄铁都折,缺口判据跟着走', () => {
    const base = buildingUpgradeQuote('mansion')
    vip(true)
    const cut = buildingUpgradeQuote('mansion')
    expect(toNum(cut.stone)).toBeLessThan(toNum(base.stone))
    expect(cut.ore).toBeLessThanOrEqual(base.ore)
  })

  it('功法进修:悟道点与残页都折', () => {
    useCultivationStore().learned[G] = 1
    const base = gongfaUpgradeQuote(G)!
    vip(true)
    const cut = gongfaUpgradeQuote(G)!
    expect(cut.wudao).toBeLessThanOrEqual(base.wudao)
    expect(cut.page).toBeLessThanOrEqual(base.page)
    expect(base.page > 1 ? cut.page < base.page : cut.page === base.page).toBe(true)
  })

  it('服务端无头结算认 vip 入参:同一份档,spend 少一成', () => {
    // 用建筑:造价是灵石大数,九折看得出来(功法进修一级只要几个悟道点,向上取整后不成差)
    const op = { op: 'buildingUpgrade', id: 'mansion' }
    const plain = resolveLevelFromSlices(saveWith(), op)!
    const paid = resolveLevelFromSlices(saveWith(), op, {}, true)!
    expect(plain.ok && paid.ok).toBe(true)
    expect(toNum(paid.spend.stone), 'VIP 少扣一成').toBeLessThan(toNum(plain.spend.stone))
  })

  it('服务端结算完把注入器还给客户端那一个,不留下「永远 VIP」', () => {
    vip(false)
    resolveLevelFromSlices(saveWith(), { op: 'gongfaUpgrade', id: G }, {}, true)
    expect(spendRate(), '结算结束后应恢复原注入器').toBe(1)
  })
})

describe('买卖不对称(防套利)', () => {
  const store = readFileSync(new URL('../stores/market.ts', import.meta.url), 'utf8')
  const service = readFileSync(new URL('./marketService.ts', import.meta.url), 'utf8')

  it('买入折、回收不折:只折一侧才不会「九折买、原价卖」', () => {
    expect(store, '扣的是折后价').toContain('resources.spendStone(pay)')
    expect(store, '折价只有一个出海口').toContain('marketPayPrice(slot.price)')
    // 三个回收价函数体内不得出现折算:材料 / 灵草 / 丹药
    for (const fn of ['pillSellPrice', 'materialSellPrice', 'herbSellPrice']) {
      const body = service.slice(service.indexOf(`export function ${fn}`), service.indexOf(`export function ${fn}`) + 400)
      expect(body, `${fn} 是回收价,不该折`).not.toContain('cutGNum')
      expect(body, `${fn} 是回收价,不该折`).not.toContain('cutCount')
    }
  })

  it('货架实付价:VIP 九折,未注入原价', () => {
    const price = gn(1000)
    expect(toNum(marketPayPrice(price))).toBe(1000)
    vip(true)
    expect(toNum(marketPayPrice(price))).toBe(900)
  })

  it('任务上交材料也不折:那是物物交换,不是修行开销', () => {
    const bounty = readFileSync(new URL('../stores/bounty.ts', import.meta.url), 'utf8')
    expect(bounty).not.toContain('spendRate')
  })
})

describe('跨端同一系数', () => {
  it('服务端 vip.ts 的 VIP_SPEND_RATE 与客户端一致', () => {
    const src = readFileSync(new URL('../../server/src/vip.ts', import.meta.url), 'utf8')
    expect(src).toContain(`export const VIP_SPEND_RATE = ${VIP_SPEND_RATE}`)
  })
})
