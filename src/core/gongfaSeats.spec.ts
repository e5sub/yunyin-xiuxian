/**
 * 副席账法:辅修看藏经阁预算、秘术固定一席,两门类**各算各的**。
 *
 * 旧账法把二者搜进同一个预算,藏经阁未升时只有一席 —— 挂上辅修就再挂不上秘术,
 * 玩家看到的是「辅修与秘术只能装一个」。此处只钉纯账法(不碰 store):
 * 各门类取几席、按序封顶、脏数据不白吃席面。
 * store 与读档的同口径见 stores/cultivation.spec.ts 与 core/loadoutService.spec.ts。
 */
import { describe, expect, it } from 'vitest'
import { canSeat, effectiveSubs, seatedCount, seatCapOf, SECRET_SEATS } from './gongfaSeats'

const SUB_A = 's_tuna' // 辅修:修炼速度
const SUB_B = 's_lianti' // 辅修:气血
const SECRET_A = 'x_tianyan' // 秘术:机缘
const SECRET_B = 'x_sanqing' // 秘术:修炼速度

describe('副席:辅修与秘术各算各的账', () => {
  it('门类各自取席面:辅修看预算,秘术固定一席,主修不占副席', () => {
    expect(seatCapOf(SUB_A, 3)).toBe(3)
    expect(seatCapOf(SECRET_A, 3)).toBe(SECRET_SEATS)
    expect(seatCapOf(SECRET_A, 0), '藏经阁缩到 0 也不影响秘术席').toBe(SECRET_SEATS)
    expect(seatCapOf('m_taixuan', 3)).toBe(0)
    expect(seatCapOf('查无此功', 3)).toBe(0)
  })

  it('只有一席辅修预算时,一本辅修 + 一本秘术同时在席', () => {
    const ids = [SUB_A, SECRET_A]
    expect(effectiveSubs(ids, 1)).toEqual(ids)
    expect(seatedCount(ids, 'sub', 1)).toBe(1)
    expect(seatedCount(ids, 'secret', 1)).toBe(1)
  })

  it('同门类按加装顺序封顶,超出的保留在列表里但不出词条', () => {
    const ids = [SUB_A, SUB_B, SECRET_A, SECRET_B]
    expect(effectiveSubs(ids, 1)).toEqual([SUB_A, SECRET_A])
    expect(effectiveSubs(ids, 2)).toEqual([SUB_A, SUB_B, SECRET_A])
    // 藏经阁缩水到 0:辅修全下席,秘术仍有一席
    expect(effectiveSubs(ids, 0)).toEqual([SECRET_A])
  })

  it('查无此门/主修的脏数据不白吃席面', () => {
    expect(effectiveSubs(['m_taixuan', 'nope', SUB_A], 1)).toEqual([SUB_A])
    expect(canSeat([], 'm_taixuan', 3)).toBe(false)
    expect(canSeat([], 'nope', 3)).toBe(false)
  })

  it('能否加装:各看自己那门,辅修满了不妨碍挂秘术', () => {
    expect(canSeat([SUB_A], SECRET_A, 1), '辅修席满,秘术席还空着').toBe(true)
    expect(canSeat([SUB_A], SUB_B, 1), '辅修席已满').toBe(false)
    expect(canSeat([SUB_A], SUB_B, 2)).toBe(true)
    expect(canSeat([SECRET_A], SECRET_B, 5), '秘术只有一席,与藏经阁无关').toBe(false)
    expect(canSeat([SUB_A], SUB_A, 3), '已在列表里的不重复加').toBe(false)
    expect(canSeat([], SUB_A, Number.NaN), 'NaN 席面不许当成无限').toBe(false)
  })
})
