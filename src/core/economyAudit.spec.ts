/**
 * 经济两极化回归护栏:灵石 income-vs-sink 不恶化。
 * 已知、有意维持的形态:早期硬瓶颈(realm 0 ratio < 0.7);境界 ~10 起收入(stoneByTier 1.9^tier)
 * 跑赢全部消耗端,资源持有无上限。持有 cap / 后期新消耗端待产品决策;本 spec 把当前读数锁为基线,只拦恶化。
 * 改 price/combat/pacing 须重审这两极。
 */
import { describe, expect, it } from 'vitest'
import { auditEra, fullEconomyAudit } from './economySim'

/** 代表性大境界:早期瓶颈 / 中期过剩起势 / 后期闲置 */
const EARLY_REALM = 0
const MID_REALM = 10
const LATE_REALM = 18

/** 基线(2026-10 数据):EARLY_REALM 读数 0.538;LATE_REALM 读数 15.98,全程峰值 18.84 */
const EARLY_ACCEPTED_FLOOR = 0.5
const LATE_ACCEPTED_CEILING = 19

/** 该境界灵石收入/消耗比值,唯一口径:economySim 审计 */
function stoneRatio(major: number): number {
  const flow = auditEra(major).flows.find(f => f.resource === 'stone')
  if (!flow) throw new Error(`auditEra(${major}) 缺 stone 流`)
  return flow.ratio === Infinity ? Infinity : flow.ratio
}

describe('经济两极化回归护栏 · income-vs-sink 不恶化', () => {
  it('早期 pole:硬瓶颈(比值 <0.7),且不被压得更低(不恶化)', () => {
    const early = stoneRatio(EARLY_REALM)
    expect(early, '早期应处于瓶颈档(<0.7)').toBeLessThan(0.7)
    expect(early, '早期比值不得低于已记录基线 —— 越低越瓶颈,即恶化').toBeGreaterThanOrEqual(EARLY_ACCEPTED_FLOOR)
  })

  it('后期 pole:收入过剩(闲置,>10),且不被推得更高(不恶化)', () => {
    const late = stoneRatio(LATE_REALM)
    expect(late, '后期应处于闲置档(>10)').toBeGreaterThan(10)
    expect(late, '后期比值不得超出已记录基线 —— 越高越过剩,即恶化').toBeLessThanOrEqual(LATE_ACCEPTED_CEILING)
  })

  it('中期 realm ~10 亦已进入闲置带,且不突破同一 ceiling', () => {
    const mid = stoneRatio(MID_REALM)
    expect(mid, '中期(~10)应已处于闲置带(>10)').toBeGreaterThan(10)
    expect(mid, '中期比值同样不得突破已记录 ceiling').toBeLessThanOrEqual(LATE_ACCEPTED_CEILING)
  })

  it('全程峰值被同一 ceiling 锁死(不漏采:任何大境界都不得突破已记录峰值)', () => {
    const peek = Math.max(
      ...fullEconomyAudit()
        .map(e => e.flows.find(f => f.resource === 'stone')?.ratio ?? 0)
        .filter(r => r !== Infinity && Number.isFinite(r))
    )
    expect(peek, '任何大境界的 stoneRatio 都不得突破已记录 ceiling').toBeLessThanOrEqual(LATE_ACCEPTED_CEILING)
    // 防横盘塌陷掩盖回归
    expect(peek, '全程峰值应保持过剩档').toBeGreaterThan(10)
  })

  it('两极并存被文档化为已知偏离:后期过剩显著高于早期瓶颈', () => {
    const early = stoneRatio(EARLY_REALM)
    const late = stoneRatio(LATE_REALM)
    // 两极被拉平(后期补大消耗或砍前期收入)时本条即红:此处有产品决策待做
    expect(late).toBeGreaterThan(early * 10)
  })
})
