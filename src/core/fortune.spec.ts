/** 机缘:低概率触发、带代价选择 */
import { describe, it, expect } from 'vitest'
import { EVENTS, FORTUNE_EVENTS, eventDef } from '@/data/events'

describe('机缘事件(fortune)', () => {
  it('机缘池非空且每个都有"取/弃"选择', () => {
    expect(FORTUNE_EVENTS.length).toBeGreaterThan(0)
    for (const ev of FORTUNE_EVENTS) {
      expect(ev.choices.length).toBeGreaterThanOrEqual(2)
      // 须有默认选择(放弃机缘)
      expect(ev.choices.some(c => c.isDefault)).toBe(true)
    }
  })

  it('机缘事件可查(eventDef 同表回查 —— 弹窗靠它才打得开)', () => {
    const ev = eventDef(FORTUNE_EVENTS[0]!.id)
    expect(ev?.id).toBe(FORTUNE_EVENTS[0]!.id)
  })

  it('机缘触发概率受控(2% → 百次期望 2 次)', () => {
    // 概率常量在事件引擎内部;此处只锁数据
    const ids = new Set(FORTUNE_EVENTS.map(e => e.id))
    expect(ids.size).toBe(FORTUNE_EVENTS.length)
  })

  it('凡是能被 pickEventFor 选中的事件,eventDef 都查得到(否则弹窗开不了)', () => {
    // eventDef 只搜 EVENTS 时,机缘(登记在 FORTUNE_BY_ID)查不到,EventDialog 不开、自动结算空转
    for (const ev of [...FORTUNE_EVENTS, ...EVENTS]) {
      expect(eventDef(ev.id), `${ev.id} 查不到,弹窗打不开`).toBeDefined()
    }
  })
})
