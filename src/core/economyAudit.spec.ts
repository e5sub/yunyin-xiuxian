/**
 * 经济「两极化」回归护栏(FIX 1)—— income-vs-sink 守门。
 *
 * REVIEW 结论:从中期(境界 ~10)起,灵石/材料收入(stoneByTier 1.9^tier)开始跑赢
 * 全部消耗端(sink),ratio 约 16-19×;而资源持有无上限 → 后期囤积膨胀、无稀缺。
 * 但同一条曲线上,早期却是硬瓶颈(realm 0 ratio < 0.7)。
 *
 * 这是**已知、有意维持**(trecked known-deviation)的经济形态 —— 两级经济
 * (早期瓶颈 / 后期过剩)不是数值错误,而是一个待产品决策的开放问题:
 * 是否给资源持有加 cap、或给后期加新的可控消耗端,都还没拍板。故正确动作
 * **不是立刻重平衡**(那会连锁扰动 price/combat/pacing),而是把当前读数编码为
 * 基线,锁死「不进一步恶化」:
 *
 *   - 早期 pole(瓶颈):realm 0 读数 0.538(<0.7)。未来改动若让早期比值**更低**
 *     (更瓶颈)必须 FAIL —— 那是把本已难熬的早期再压一头。
 *   - 后期 pole(过剩/闲置):realm 18 读数 15.98,全程峰值 18.84(≈16-19×)。
 *     未来改动若让后期比值**更高**(更过剩)必须 FAIL —— 那是让囤积进一步失控。
 *
 * 未来任何经济平衡改动(price/combat/pacing)都应重审这两极,而不是让它继续开叉;
 * 本 spec 即这份「必须重审」的强制提醒。
 */
import { describe, expect, it } from 'vitest'
import { auditEra, fullEconomyAudit } from './economySim'

/** 代表性大境界:早期(瓶颈 pole)/ 中期(过剩起势)/ 后期(闲置 pole) */
const EARLY_REALM = 0
const MID_REALM = 10
const LATE_REALM = 18

/**
 * 编码自当前数据(2026-10)的基线:
 *  - EARLY_REALM 读数 0.538(瓶颈,<0.7)—— 取 0.5 作 floor,再低即恶化。
 *  - LATE_REALM 读数 15.98,全程峰值 18.84 —— 取 19 作 ceiling,再高即恶化。
 */
const EARLY_ACCEPTED_FLOOR = 0.5
const LATE_ACCEPTED_CEILING = 19

/** 该境界的灵石「收入/消耗」比值 —— 全模型唯一口径,取自 economySim 审计 */
function stoneRatio(major: number): number {
  const flow = auditEra(major).flows.find(f => f.resource === 'stone')
  if (!flow) throw new Error(`auditEra(${major}) 缺 stone 流`)
  return flow.ratio === Infinity ? Infinity : flow.ratio
}

describe('经济两极化回归护栏 · income-vs-sink 不恶化', () => {
  it('早期 pole:硬瓶颈(比值 <0.7),且不被压得更低(不恶化)', () => {
    const early = stoneRatio(EARLY_REALM)
    // 早期经济的已知形态就是「资源产出跟不上消耗」—— 这是设计成这样的硬瓶颈,
    // 不是 bug;读出来应稳在 <0.7 的「瓶颈」档。
    expect(early, '早期应处于瓶颈档(<0.7)').toBeLessThan(0.7)
    // 恶化判据:比值若跌破基线的 floor(比现在还更卡),即早期被进一步压死 —— 必须拦。
    expect(early, '早期比值不得低于已记录基线 —— 越低越瓶颈,即恶化').toBeGreaterThanOrEqual(EARLY_ACCEPTED_FLOOR)
  })

  it('后期 pole:收入过剩(闲置,>10),且不被推得更高(不恶化)', () => {
    const late = stoneRatio(LATE_REALM)
    // 后期经济的已知形态就是「收入远超消耗、资源闲置囤积」—— 亦然是设计成这样的
    // (见文件头 track-known-deviation 说明)。应稳在 >10 的「闲置」档。
    expect(late, '后期应处于闲置档(>10)').toBeGreaterThan(10)
    // 恶化判据:比值若突破基线的 ceiling(比现在还更过剩),即囤积进一步失控 —— 必须拦。
    expect(late, '后期比值不得超出已记录基线 —— 越高越过剩,即恶化').toBeLessThanOrEqual(LATE_ACCEPTED_CEILING)
  })

  it('中期 realm ~10 亦已进入闲置带,且不突破同一 ceiling', () => {
    const mid = stoneRatio(MID_REALM)
    expect(mid, '中期(~10)应已处于闲置带(>10)').toBeGreaterThan(10)
    expect(mid, '中期比值同样不得突破已记录 ceiling').toBeLessThanOrEqual(LATE_ACCEPTED_CEILING)
  })

  it('全程峰值被同一 ceiling 锁死(不漏采:任何大境界都不得突破已记录峰值)', () => {
    // 单测只抽了代表性境界;全程峰值可能落在未采样的某处,故在此扫全进度,
    // 直接锁住文档化的「全程峰值 18.84」上限(见文件头),杜绝漏网恶化。
    const peek = Math.max(
      ...fullEconomyAudit()
        .map(e => e.flows.find(f => f.resource === 'stone')?.ratio ?? 0)
        .filter(r => r !== Infinity && Number.isFinite(r))
    )
    expect(peek, '任何大境界的 stoneRatio 都不得突破已记录 ceiling').toBeLessThanOrEqual(LATE_ACCEPTED_CEILING)
    // 确认确有全程峰值这一形态在(仍在过剩档),而非横盘塌陷掩盖回归。
    expect(peek, '全程峰值应保持过剩档').toBeGreaterThan(10)
  })

  it('两极并存被文档化为已知偏离:后期过剩显著高于早期瓶颈', () => {
    const early = stoneRatio(EARLY_REALM)
    const late = stoneRatio(LATE_REALM)
    // 这条确认「真正开叉」的形态仍在:一旦未来某轮平衡把两极拉平(比如给后期补了
    // 大消耗、或砍了前期收入来源),它会立刻显形 —— 提醒维护者此处有产品决策待做。
    expect(late).toBeGreaterThan(early * 10)
  })
})
