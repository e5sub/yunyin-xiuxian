/**
 * 数值权威化判据 —— 服务端说了算的那些线,在这里钉住。
 *
 * 用例分两类,缺一不可:
 *  - 作弊侧:改境界、改修为、改灵石、改装备阶数、塞丹药,都必须被压回。
 *  - 正常侧:按玩法该有的增长一律放行 —— 防作弊最容易犯的错是把真人误伤成作弊,
 *    所以每条判据都要有一条「合法档原样通过」的对照。
 */
import { describe, expect, it } from 'vitest'
import { enforceSaveAuthority } from '@/core/saveAuthority'
import { expRequirement } from '@/core/formulas'
import { maxTierForMajor } from '@/data/regions'
import { MAX_MAJOR } from '@/data/realms'
import { toNum } from '@/utils/gnum'
import type { GNum } from '@/types'

/** 一份「刚开局不久」的合法档 */
function baseSave(): Record<string, unknown> {
  return {
    game: { started: true },
    player: { major: 0, sub: 0, exp: { m: 4, e: 1 } },
    resources: {
      spiritStone: { m: 1, e: 3 },
      herbByGrade: { 1: 10, 2: 2, 3: 0, 4: 0, 5: 0 },
      qi: 20,
      ore: 5,
      page: 1,
      dust: 3,
      wudao: 0
    },
    inventory: { items: [], pills: {} }
  }
}

const ONE_TICK_MS = 20_000
const DAY_MS = 24 * 3600_000

function run(
  next: Record<string, unknown>,
  opts: {
    prev?: Record<string, unknown> | null
    prevRealmIndex?: number
    elapsedMs?: number
    prevRebirths?: number
    realmAuthoritative?: boolean
    pendingSpend?: { m: number; e: number }
  } = {}
) {
  const report = enforceSaveAuthority({
    prev: opts.prev ?? null,
    next,
    prevRealmIndex: opts.prevRealmIndex ?? 0,
    elapsedMs: opts.elapsedMs ?? ONE_TICK_MS,
    prevRebirths: opts.prevRebirths,
    realmAuthoritative: opts.realmAuthoritative,
    pendingSpend: opts.pendingSpend
  })
  if (report === null) throw new Error('裁决返回 null')
  return report
}

function num(g: unknown): number {
  return toNum(g as GNum)
}

describe('数值权威化 · 合法档不受影响', () => {
  it('刚开局的档原样通过,不产生任何修正', () => {
    const seed = baseSave()
    const report = run({ ...baseSave() }, { prev: seed, prevRealmIndex: 0 })
    expect(report.corrections).toEqual([])
    expect(report.notes).toEqual([])
  })

  it('离线一天后正常收益放行(时间窗放大额度)', () => {
    const prev = baseSave()
    const next = baseSave()
    ;(next.player as Record<string, unknown>).exp = { m: 2, e: 3 }
    ;(next.resources as Record<string, unknown>).spiritStone = { m: 5, e: 5 }
    const report = run(next, { prev, prevRealmIndex: 0, elapsedMs: DAY_MS })
    expect(report.corrections).toEqual([])
  })

  it('未开局的空档不裁决', () => {
    const report = run({ game: { started: false }, player: { major: 28, sub: 9, exp: { m: 1, e: 500 } } })
    expect(report.corrections).toEqual([])
  })
})

describe('数值权威化 · 境界必须付得起', () => {
  it('炼气一期直接写成一境不到,被按修为预算压回', () => {
    const next = baseSave()
    ;(next.player as Record<string, unknown>).major = MAX_MAJOR
    ;(next.player as Record<string, unknown>).sub = 9
    const report = run(next, { prev: baseSave(), prevRealmIndex: 0, elapsedMs: ONE_TICK_MS })
    const player = report.data.player as Record<string, unknown>
    // 早期境界的突破需求小,单窗口的修为预算够推进几层属正常(实测 2 境);
    // 判据的用意是「到不了界外」—— MAX_MAJOR 是 28,这里留足平衡调整的余量
    expect(Number(player.major)).toBeLessThanOrEqual(5)
    expect(Number(player.major)).toBeLessThan(MAX_MAJOR)
    expect(report.corrections.some(c => c.path === 'player.major')).toBe(true)
    expect(report.notes.join(' ')).toContain('境界超出修为支撑')
  })

  it('境界倒退被拒(除转世外境界单调)', () => {
    const prev = baseSave()
    ;(prev.player as Record<string, unknown>).major = 3
    ;(prev.player as Record<string, unknown>).sub = 2
    const next = baseSave()
    const report = run(next, { prev, prevRealmIndex: 302, elapsedMs: ONE_TICK_MS })
    const player = report.data.player as Record<string, unknown>
    expect(Number(player.major)).toBe(3)
    expect(Number(player.sub)).toBe(2)
    expect(report.notes.join(' ')).toContain('境界倒退被拒')
  })

  it('转世(世号 +1)允许境界重置,新世从零起算', () => {
    const prev = baseSave()
    ;(prev.player as Record<string, unknown>).major = 6
    ;(prev.player as Record<string, unknown>).sub = 0
    ;(prev.player as Record<string, unknown>).reincarnation = { count: 0 }
    const next = baseSave()
    ;(next.player as Record<string, unknown>).reincarnation = { count: 1 }
    const report = run(next, { prev, prevRealmIndex: 600, elapsedMs: ONE_TICK_MS })
    const player = report.data.player as Record<string, unknown>
    expect(Number(player.major)).toBe(0)
    expect(Number(player.sub)).toBe(0)
    expect(report.corrections.some(c => c.path === 'player.major')).toBe(false)
  })

  it('攒够修为后连续突破放行(存量修为够付)', () => {
    // 0-0 攒到远超需求,凭存量修为可推进数层
    const prev = baseSave()
    ;(prev.player as Record<string, unknown>).exp = { m: 5, e: 2 }
    const next = baseSave()
    ;(next.player as Record<string, unknown>).sub = 3
    ;(next.player as Record<string, unknown>).exp = { m: 1, e: 1 }
    const report = run(next, { prev, prevRealmIndex: 0, elapsedMs: ONE_TICK_MS })
    const player = report.data.player as Record<string, unknown>
    expect(Number(player.sub)).toBe(3)
  })
})

describe('数值权威化 · 修为与资源上限', () => {
  it('修为写 e500 被压到本境界持有上限', () => {
    const next = baseSave()
    ;(next.player as Record<string, unknown>).exp = { m: 1, e: 500 }
    const report = run(next, { prev: baseSave(), prevRealmIndex: 0 })
    const exp = (report.data.player as Record<string, unknown>).exp as GNum
    expect(num(exp)).toBeLessThanOrEqual(num(expRequirement(0, 0)) * 100)
    expect(report.corrections.some(c => c.path === 'player.exp')).toBe(true)
  })

  it('灵石写 e100 被压回该境界持有上限', () => {
    const next = baseSave()
    ;(next.resources as Record<string, unknown>).spiritStone = { m: 1, e: 100 }
    const report = run(next, { prev: baseSave(), prevRealmIndex: 0 })
    const stone = (report.data.resources as Record<string, unknown>).spiritStone as GNum
    // 炼气期满产 30 天也不到 1e8(实测 ≈3.5e6),e100 必须被砍下来
    expect(num(stone)).toBeLessThan(1e8)
    expect(report.corrections.some(c => c.path === 'resources.spiritStone')).toBe(true)
  })

  it('灵草与杂项资源同步收口', () => {
    const next = baseSave()
    const res = next.resources as Record<string, unknown>
    res.herbByGrade = { 1: 1e12, 2: 0, 3: 0, 4: 0, 5: 0 }
    res.ore = 1e12
    const report = run(next, { prev: baseSave(), prevRealmIndex: 0 })
    const after = report.data.resources as Record<string, unknown>
    expect((after.herbByGrade as Record<string, number>)[1]).toBeLessThan(1e12)
    expect(Number(after.ore)).toBeLessThan(1e12)
  })

  it('资源一次拉到持有上限被拦:增量受本窗口可增长量约束(1.58.1)', () => {
    const prev = baseSave()
    ;(prev.resources as Record<string, unknown>).spiritStone = { m: 1, e: 3 } // 1000
    const next = baseSave()
    ;(next.resources as Record<string, unknown>).spiritStone = { m: 1, e: 7 } // 1e7:远超一窗口的产出
    const report = run(next, { prev, prevRealmIndex: 0, elapsedMs: ONE_TICK_MS })
    const stone = (report.data.resources as Record<string, unknown>).spiritStone as GNum
    expect(num(stone)).toBeLessThan(1e7)
    expect(report.notes.join(' ')).toContain('灵石超本窗口可增长量')
  })

  it('坊市支出未在档里体现:灵石被压到「付得起」的位置(1.58.1)', () => {
    const prev = baseSave()
    ;(prev.resources as Record<string, unknown>).spiritStone = { m: 2, e: 6 } // 200 万
    const next = baseSave()
    ;(next.resources as Record<string, unknown>).spiritStone = { m: 2, e: 6 } // 一分钱没扣
    const report = run(next, {
      prev,
      prevRealmIndex: 0,
      elapsedMs: 60_000,
      pendingSpend: { m: 1, e: 6 } // 花了一百万:远超「成批进项」余量
    })
    const stone = (report.data.resources as Record<string, unknown>).spiritStone as GNum
    expect(num(stone)).toBeLessThan(2e6)
    expect(report.corrections.some(c => c.path === 'resources.spiritStone')).toBe(true)
  })

  it('坊市支出已兑现(灵石确实少了 8000):零修正通过', () => {
    const prev = baseSave()
    ;(prev.resources as Record<string, unknown>).spiritStone = { m: 2, e: 6 } // 200 万
    const next = baseSave()
    ;(next.resources as Record<string, unknown>).spiritStone = { m: 1, e: 6 } // 付掉一百万
    const report = run(next, { prev, prevRealmIndex: 0, elapsedMs: 60_000, pendingSpend: { m: 1, e: 6 } })
    expect(report.corrections.some(c => c.path === 'resources.spiritStone')).toBe(false)
  })

  it('成批进项(卖装备/领奖励的价差)仍放行:几倍于上次值不算作弊', () => {
    const prev = baseSave()
    ;(prev.resources as Record<string, unknown>).spiritStone = { m: 1, e: 3 } // 1000
    const next = baseSave()
    ;(next.resources as Record<string, unknown>).spiritStone = { m: 5, e: 3 } // 5000
    const report = run(next, { prev, prevRealmIndex: 0, elapsedMs: ONE_TICK_MS })
    expect(report.corrections.some(c => c.path === 'resources.spiritStone')).toBe(false)
  })

  it('灵气超积余上限被压回', () => {
    const next = baseSave()
    ;(next.resources as Record<string, unknown>).qi = 1e12
    const report = run(next, { prev: baseSave(), prevRealmIndex: 0 })
    expect(Number((report.data.resources as Record<string, unknown>).qi)).toBeLessThan(1e12)
  })
})

describe('数值权威化 · 装备与丹药', () => {
  it('装备阶数不得超过境界解锁层级', () => {
    const next = baseSave()
    ;(next.inventory as Record<string, unknown>).items = [
      { uid: 'a', templateId: 't', quality: 'mortal', tier: 40, level: 0, affixes: [] },
      { uid: 'b', templateId: 't', quality: 'mortal', tier: 1, level: 0, affixes: [] }
    ]
    const report = run(next, { prev: baseSave(), prevRealmIndex: 0 })
    const items = (report.data.inventory as Record<string, unknown>).items as Array<{ tier: number }>
    expect(items[0]!.tier).toBe(maxTierForMajor(0))
    // 合法阶数原样保留
    expect(items[1]!.tier).toBe(1)
    expect(report.corrections.some(c => c.path === 'inventory.items')).toBe(true)
  })

  it('丹药堆叠超上限被压回', () => {
    const next = baseSave()
    ;(next.inventory as Record<string, unknown>).pills = { some_pill: 999999 }
    const report = run(next, { prev: baseSave(), prevRealmIndex: 0 })
    const pills = (report.data.inventory as Record<string, unknown>).pills as Record<string, number>
    expect(pills.some_pill).toBe(9999)
  })
})

describe('数值权威化 · 不改动输入', () => {
  it('裁决不污染调用方传入的对象', () => {
    const next = baseSave()
    ;(next.player as Record<string, unknown>).major = MAX_MAJOR
    const snapshot = JSON.stringify(next)
    run(next, { prev: baseSave(), prevRealmIndex: 0 })
    expect(JSON.stringify(next)).toBe(snapshot)
  })
})

describe('数值权威化 · 境界只认服务端(1.57.0+ 客户端)', () => {
  function runAuth(
    next: Record<string, unknown>,
    opts: { prev?: Record<string, unknown> | null; prevRealmIndex?: number; elapsedMs?: number } = {}
  ) {
    const report = enforceSaveAuthority({
      prev: opts.prev ?? null,
      next,
      prevRealmIndex: opts.prevRealmIndex ?? 0,
      elapsedMs: opts.elapsedMs ?? ONE_TICK_MS,
      realmAuthoritative: true
    })
    if (report === null) throw new Error('裁决返回 null')
    return report
  }

  it('上报抬境:即使修为预算付得起,也一律压回服务端基线', () => {
    const next = baseSave()
    ;(next.player as Record<string, unknown>).major = 5
    ;(next.player as Record<string, unknown>).sub = 0
    const report = runAuth(next, { prev: baseSave(), prevRealmIndex: 0 })
    expect((report.data.player as Record<string, unknown>).major).toBe(0)
    expect((report.data.player as Record<string, unknown>).sub).toBe(0)
    expect(report.corrections.some(c => c.path === 'player.major')).toBe(true)
  })

  it('上报压境(改包/回档残影):同样压回基线', () => {
    const next = baseSave()
    ;(next.player as Record<string, unknown>).major = 0
    ;(next.player as Record<string, unknown>).sub = 0
    const report = runAuth(next, { prev: baseSave(), prevRealmIndex: 205 })
    expect((report.data.player as Record<string, unknown>).major).toBe(2)
    expect((report.data.player as Record<string, unknown>).sub).toBe(5)
  })

  it('境界与基线一致:零修正通过(突破 API 落账后的正常上传)', () => {
    const next = baseSave()
    ;(next.player as Record<string, unknown>).major = 1
    ;(next.player as Record<string, unknown>).sub = 4
    const report = runAuth(next, { prev: baseSave(), prevRealmIndex: 104 })
    expect(report.corrections).toEqual([])
    expect(report.notes).toEqual([])
  })

  it('转世(世号增加):新世从 0-0 起算,不受基线约束', () => {
    const prev = baseSave()
    ;(prev.player as Record<string, unknown>).reincarnation = { count: 3 }
    const next = baseSave()
    ;(next.player as Record<string, unknown>).major = 0
    ;(next.player as Record<string, unknown>).sub = 0
    ;(next.player as Record<string, unknown>).reincarnation = { count: 4 }
    const report = runAuth(next, { prev, prevRealmIndex: 608 })
    expect((report.data.player as Record<string, unknown>).major).toBe(0)
  })

  it('对照:同样上报抬境,不带标记的老客户端沿用预算判据(可能被放行)', () => {
    const next = baseSave()
    ;(next.player as Record<string, unknown>).major = 0
    ;(next.player as Record<string, unknown>).sub = 1
    const report = run(next, { prev: baseSave(), prevRealmIndex: 0 })
    // 预算判据下,紧邻的一小层在 60 秒窗口内付得起 → 放行
    expect((report.data.player as Record<string, unknown>).sub).toBe(1)
  })
})

/**
 * 转世乘区与时间账(1.58.1)。
 * 这几条的共同点:值域「形状合法」,但**没有与之匹配的底数** ——
 * 道果/天赋由世号决定,年龄/游玩时长由真实经过时长决定。填多大都得先问底数答不答应。
 */
describe('数值权威化 · 转世乘区与时间账', () => {
  it('世号超服务端基线:压回「基线 + 1」', () => {
    const next = baseSave()
    ;(next.player as Record<string, unknown>).reincarnation = { count: 999, daoFruit: 0, talents: [] }
    const report = run(next, { prev: baseSave(), prevRealmIndex: 0, prevRebirths: 2 })
    const reinc = (report.data.player as Record<string, unknown>).reincarnation as Record<string, unknown>
    expect(reinc.count).toBe(3)
    expect(report.corrections.some(c => c.path === 'player.reincarnation.count')).toBe(true)
  })

  it('道果超世号支撑:压回「世号 × 满境折算」', () => {
    const next = baseSave()
    ;(next.player as Record<string, unknown>).reincarnation = { count: 1, daoFruit: 1e9, talents: [] }
    const report = run(next, { prev: baseSave(), prevRealmIndex: 0, prevRebirths: 1 })
    const reinc = (report.data.player as Record<string, unknown>).reincarnation as Record<string, unknown>
    // 一世满境至多 daoFruitGain(MAX_MAJOR, 满层);1e9 必须被砍下好几个数量级
    expect(Number(reinc.daoFruit)).toBeLessThan(10_000)
    expect(report.notes.join(' ')).toContain('道果超世号所支撑')
  })

  it('零世号不得有道果(新档凭空写乘区)', () => {
    const next = baseSave()
    ;(next.player as Record<string, unknown>).reincarnation = { count: 0, daoFruit: 500, talents: [] }
    const report = run(next, { prev: baseSave(), prevRealmIndex: 0, prevRebirths: 0 })
    const reinc = (report.data.player as Record<string, unknown>).reincarnation as Record<string, unknown>
    expect(reinc.daoFruit).toBe(0)
  })

  it('天赋数超世号支撑:截断(保留最早的)', () => {
    const next = baseSave()
    const talents = Array.from({ length: 33 }, (_, i) => `t_${i}`)
    ;(next.player as Record<string, unknown>).reincarnation = { count: 1, daoFruit: 0, talents }
    const report = run(next, { prev: baseSave(), prevRealmIndex: 0, prevRebirths: 1 })
    const reinc = (report.data.player as Record<string, unknown>).reincarnation as Record<string, unknown>
    // 一世至多 1 + floor(MAX_MAJOR / TALENT_DRAW_DIV) 个
    expect((reinc.talents as unknown[]).length).toBeLessThan(33)
    expect((reinc.talents as unknown[])[0]).toBe('t_0')
    expect(report.notes.join(' ')).toContain('天赋数超世号所支撑')
  })

  it('寿元加算写天文数字:压回绝对上限', () => {
    const next = baseSave()
    ;(next.player as Record<string, unknown>).lifespanBonusYears = 1e9
    const report = run(next, { prev: baseSave(), prevRealmIndex: 0 })
    const player = report.data.player as Record<string, unknown>
    expect(Number(player.lifespanBonusYears)).toBe(1_000_000)
    expect(report.notes.join(' ')).toContain('寿元加算超上限')
  })

  it('年龄跳增超本窗口时长:压回可用岁数', () => {
    const prev = baseSave()
    ;(prev.player as Record<string, unknown>).age = 30
    const next = baseSave()
    ;(next.player as Record<string, unknown>).age = 5000
    // 20 秒窗口:至多长 0.0056 岁,给 1 岁弛豫
    const report = run(next, { prev, prevRealmIndex: 0, elapsedMs: ONE_TICK_MS })
    const player = report.data.player as Record<string, unknown>
    expect(Number(player.age)).toBeLessThan(32)
    expect(report.notes.join(' ')).toContain('年龄增长超本窗口时长')
  })

  it('年龄被回拨:压回上次(除转世外年龄单调)', () => {
    const prev = baseSave()
    ;(prev.player as Record<string, unknown>).age = 80
    const next = baseSave()
    ;(next.player as Record<string, unknown>).age = 20
    const report = run(next, { prev, prevRealmIndex: 0, elapsedMs: ONE_TICK_MS })
    expect((report.data.player as Record<string, unknown>).age).toBe(80)
    expect(report.notes.join(' ')).toContain('年龄被回拨')
  })

  it('游玩时长往前推一天:压回真实经过时长', () => {
    const prev = baseSave()
    ;(prev.game as Record<string, unknown>).totalPlaySec = 3600
    const next = baseSave()
    ;(next.game as Record<string, unknown>).totalPlaySec = 3600 + 86400
    const report = run(next, { prev, prevRealmIndex: 0, elapsedMs: ONE_TICK_MS })
    const game = report.data.game as Record<string, unknown>
    expect(Number(game.totalPlaySec)).toBeLessThan(3600 + 120)
    expect(report.notes.join(' ')).toContain('游玩时长超真实经过时长')
  })

  it('合法档:正常年龄增长、时长推进、转世带道果天赋,一律零修正', () => {
    const prev = baseSave()
    Object.assign(prev.game as Record<string, unknown>, { totalPlaySec: 7200 })
    Object.assign(prev.player as Record<string, unknown>, { age: 40, reincarnation: { count: 2, daoFruit: 60, talents: ['t_jianxin'] } })
    const next = baseSave()
    // 一小时:年龄 +1(AGE_YEARS_PER_HOUR),时长 +3600
    Object.assign(next.game as Record<string, unknown>, { totalPlaySec: 7200 + 3600 })
    Object.assign(next.player as Record<string, unknown>, {
      age: 41,
      reincarnation: { count: 2, daoFruit: 80, talents: ['t_jianxin', 't_fuyuan'] }
    })
    const report = run(next, { prev, prevRealmIndex: 0, elapsedMs: 3600_000, prevRebirths: 2 })
    expect(report.corrections).toEqual([])
  })
})
