/** 收徒「各尽其长」决策(`dispatchAllToNeed` / `needTargetDoor`);钉导演口径「040/030/030/030」与历练固定兜底分 */
import { describe, it, expect } from 'vitest'
import {
  apprenticeRecruitCost,
  apprenticeRecruitShortfall,
  dispatchAllToNeed,
  dispatchTargetsFromStocks,
  needTargetDoor,
  type DispatchNeedStock
} from './apprenticeService'
import { sub } from '@/utils/gnum'

describe('收道童 · 报价与缺口同源', () => {
  it('只差一部分时报实际差额,余额够时缺口归零', () => {
    const cost = apprenticeRecruitCost(6)
    const gap = apprenticeRecruitShortfall(6, sub(cost, { m: 7, e: 0 }))
    expect(gap.m).toBeGreaterThan(0)
    expect(apprenticeRecruitShortfall(6, cost).m).toBe(0)
  })
})

describe('各尽其长 · needTargetDoor 取最缺之门', () => {
  it('采药最缺时,取「采药」为唯一目标', () => {
    // 灵草见底(score 40),其余三门皆够(score ≈0.97)
    const stock: DispatchNeedStock = { herb: 0, ore: 30, wudao: 30, dust: 30, seek: 20 }
    expect(needTargetDoor(stock)).toBe('herb')
  })

  it('皆有余(资源全满)时,历练以固定兜底分胜出', () => {
    // 三门资源 score 皆 < 0.25,历练固定分 0.25 独大
    const stock: DispatchNeedStock = { herb: 200, ore: 150, wudao: 150, dust: 150, seek: 50 }
    expect(needTargetDoor(stock)).toBe('adventure')
  })

  it('四门短缺分全并列时,返回 null(→各自专职)', () => {
    // 各资源 score 恰为 1.0:herb 40/40、ore 30/30、study 30/30、dust 30/30
    const stock: DispatchNeedStock = { herb: 39, ore: 29, wudao: 29, dust: 29, seek: 9 }
    expect(needTargetDoor(stock)).toBeNull()
  })

  it('谷有余而丹药见底时,取「寻机缘」为唯一目标', () => {
    // 四门皆够(score ≈0.97),丹药存量 0 → seek score 10/1=10 独大
    const stock: DispatchNeedStock = { herb: 40, ore: 30, wudao: 30, dust: 30, seek: 0 }
    expect(needTargetDoor(stock)).toBe('seek')
  })
})

describe('各尽其长 · dispatchAllToNeed 派发', () => {
  it('无闲置道童:不派,返回空', () => {
    const stock: DispatchNeedStock = { herb: 0, ore: 30, wudao: 30, dust: 30, seek: 20 }
    expect(dispatchAllToNeed([], stock)).toEqual([])
  })

  it('采药最缺:全体闲置道童都去采药(各自天赋被压下)', () => {
    const stock: DispatchNeedStock = { herb: 0, ore: 30, wudao: 30, dust: 30, seek: 20 }
    const idle = [
      { uid: 'u1', talent: 'study' as const },
      { uid: 'u2', talent: 'ore' as const },
      { uid: 'u3', talent: 'herb' as const }
    ]
    expect(dispatchAllToNeed(idle, stock)).toEqual([
      { uid: 'u1', spec: 'herb' },
      { uid: 'u2', spec: 'herb' },
      { uid: 'u3', spec: 'herb' }
    ])
  })

  it('皆有余:全体闲置道童都去历练挣灵石', () => {
    const stock: DispatchNeedStock = { herb: 200, ore: 150, wudao: 150, dust: 150, seek: 50 }
    const idle = [
      { uid: 'u1', talent: 'study' as const },
      { uid: 'u2', talent: 'herb' as const }
    ]
    expect(dispatchAllToNeed(idle, stock)).toEqual([
      { uid: 'u1', spec: 'adventure' },
      { uid: 'u2', spec: 'adventure' }
    ])
  })

  it('四门短缺分全并列:全体各自专职,各回各的天赋之门', () => {
    const stock: DispatchNeedStock = { herb: 39, ore: 29, wudao: 29, dust: 29, seek: 9 }
    const idle = [
      { uid: 'u1', talent: 'study' as const },
      { uid: 'u2', talent: 'adventure' as const },
      { uid: 'u3', talent: 'herb' as const }
    ]
    expect(dispatchAllToNeed(idle, stock)).toEqual([
      { uid: 'u1', spec: 'study' },
      { uid: 'u2', spec: 'adventure' },
      { uid: 'u3', spec: 'herb' }
    ])
  })
})

describe('离线派工 · dispatchTargetsFromStocks(1.74.5 服务端单源口径)', () => {
  /** 服务端从存档分片读到的是 herbByGrade 全档与丹药总量;herb 取数随境界品阶 */
  it('herb 按当前境界取对应品阶:凡境取 1 档,高境取高档', () => {
    const byGrade = { '1': 0, '2': 500 }
    const low = dispatchTargetsFromStocks([{ uid: 'u1', archId: 'ap_luanniao' }], { herbByGrade: byGrade, ore: 5, wudao: 7, dust: 9, seek: 3 }, 0)
    const high = dispatchTargetsFromStocks([{ uid: 'u1', archId: 'ap_luanniao' }], { herbByGrade: byGrade, ore: 5, wudao: 7, dust: 9, seek: 3 }, 6)
    // 凡境(0~4)取 1 档存量 0 → 采药短缺分 40 最高,去采药;仙境(5~8)取 2 档存量 500 → 短缺分骤降,玄铁最缺
    expect(low[0]!.spec).toBe('herb')
    expect(high[0]!.spec).not.toBe('herb')
  })

  it('并列无单门胜出时各自专职:天赋从 archId 现查,不靠调用方喂', () => {
    const all = [
      { uid: 'u1', archId: 'ap_luanniao' }, // 天赋 herb
      { uid: 'u2', archId: 'ap_kuangtou' } // 天赋 ore
    ]
    const herbShort = dispatchTargetsFromStocks(all, { herbByGrade: { '1': 0 }, ore: 9999, wudao: 9999, dust: 9999, seek: 9999 }, 0)
    expect(herbShort[0]!.spec).toBe('herb')
    expect(herbShort[1]!.spec).toBe('herb')
    // 寻宝短缺分 10 必须压过历练兜底分与器尘短缺分:器尘给 20(30/21≈1.43 < 10)
    const seekShort = dispatchTargetsFromStocks(all, { herbByGrade: { '1': 9999 }, ore: 9999, wudao: 9999, dust: 20, seek: 0 }, 0)
    expect(seekShort[0]!.spec).toBe('seek')
    expect(seekShort[1]!.spec).toBe('seek')
  })

  it('野 archId 兜底 herb 门,不抛错', () => {
    const out = dispatchTargetsFromStocks([{ uid: 'u1', archId: 'ap_ghost' }], { herbByGrade: { '1': 9999 }, ore: 9999, wudao: 9999, dust: 9999, seek: 9999 }, 0)
    expect(out).toHaveLength(1)
    expect(out[0]!.spec).toBe('adventure') // 全不缺 → 历练兜底分胜出
  })
})
