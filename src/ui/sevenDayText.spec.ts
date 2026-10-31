/** 周天七会的展示口径:达标判定、进度读数、赏格拆条;与服务端 claim 同源,防「显示已达标、点领赏被拒」 */
import { describe, expect, it } from 'vitest'
import { eventDone, eventProgressLabel, eventProgressValue, eventRewardParts, weekdayName } from './sevenDayText'
import type { DailyEventView, EventReward } from '@/services/cloud'

function ev(over: Partial<DailyEventView> = {}): DailyEventView {
  return {
    id: 'e_mon_duel',
    dow: 1,
    name: '论道会',
    tag: '论道',
    desc: '',
    kind: 'duel',
    target: 3,
    rule: '',
    reward: { stone: 0, herb: 0, wudao: 0, ore: 0, dust: 0, page: 0 },
    to: '/friends',
    ...over
  }
}

describe('周天七会 · 展示口径', () => {
  it('星期名:1=周一、7=周日,越界给空串', () => {
    expect(weekdayName(1)).toBe('周一')
    expect(weekdayName(7)).toBe('周日')
    expect(weekdayName(0)).toBe('')
    expect(weekdayName(9)).toBe('')
  })

  it('切磋/秘境型:进度到线即达标,超出也算', () => {
    const e = ev()
    expect(eventDone(e, 2, null)).toBe(false)
    expect(eventDone(e, 3, null)).toBe(true)
    expect(eventDone(e, 9, null)).toBe(true)
  })

  it('天榜型:只看名次,不看进度;未上榜不算达标', () => {
    const e = ev({ kind: 'board', target: 50 })
    expect(eventDone(e, 99, null)).toBe(false)
    expect(eventDone(e, 0, 51)).toBe(false)
    expect(eventDone(e, 0, 50)).toBe(true)
    expect(eventDone(e, 0, 1)).toBe(true)
  })

  it('进度读数按活动类型换词,且不越界显示', () => {
    expect(eventProgressLabel(ev({ kind: 'arena' }))).toBe('今日最好连胜')
    expect(eventProgressLabel(ev({ kind: 'board', target: 50 }))).toContain('前 50')
    expect(eventProgressValue(ev(), 5, null)).toBe('3 / 3')
    expect(eventProgressValue(ev(), -1, null)).toBe('0 / 3')
    expect(eventProgressValue(ev({ kind: 'board', target: 50 }), 0, null)).toBe('未上榜')
    expect(eventProgressValue(ev({ kind: 'board', target: 50 }), 0, 12)).toBe('第 12 名')
  })

  it('赏格只列非零项,顺序固定', () => {
    const r: EventReward = { stone: 120, herb: 0, wudao: 18, ore: 0, dust: 0, page: 0 }
    expect(eventRewardParts(r).map(p => p.key)).toEqual(['stone', 'wudao'])
    expect(eventRewardParts(r).map(p => p.n)).toEqual([120, 18])
    const full: EventReward = { stone: 1, herb: 2, wudao: 3, ore: 4, dust: 5, page: 6 }
    expect(eventRewardParts(full).map(p => p.key)).toEqual(['stone', 'wudao', 'herb', 'ore', 'dust', 'page'])
    expect(eventRewardParts({ stone: 0, herb: 0, wudao: 0, ore: 0, dust: 0, page: 0 })).toEqual([])
  })
})
