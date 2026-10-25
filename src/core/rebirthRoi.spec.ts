/* eslint-disable no-console */
/**
 * 轮回 ROI 审计:道果对境界二次增长、耗时指数增长,浅修快轮回是数值最优。
 * 绝对小时数不可信(见 saveCalibration),读数均为同一把尺子下的比值。
 */
import { describe, expect, it } from 'vitest'
import { MANUAL_REBIRTH_MIN_MAJOR } from './reincarnation'
import { fullSecondsForMajor, growthOrders, marginalTable, optimalRebirthPoint, rebirthPoints } from './rebirthRoi'
import { estimateCultMult } from './progressionSim'
import { baseCultPerSec, expRequirement } from './formulas'
import { SUB_LEVELS } from '@/data/constants'
import { toNum } from '@/utils/gnum'

const NAMES = ['炼气', '筑基', '金丹', '元婴', '化神', '炼虚', '合体', '大乘', '渡劫', '真仙']

describe('轮回 ROI · 各转世点的道果效率', () => {
  it('合法转世点的效率表', () => {
    const rows = rebirthPoints()
    const best = optimalRebirthPoint()
    console.log(`\n轮回门槛:major≥${MANUAL_REBIRTH_MIN_MAJOR}(${NAMES[MANUAL_REBIRTH_MIN_MAJOR]})`)
    console.log('境界   道果   修满耗时    道果/时   相对最优')
    for (const r of rows) {
      console.log(
        `${NAMES[r.major]!.padEnd(4)} ${String(r.fruit).padStart(4)} ${r.hours.toFixed(1).padStart(9)}h ` +
          `${r.efficiency.toFixed(3).padStart(9)} ${((r.efficiency / best.efficiency) * 100).toFixed(0).padStart(6)}%`
      )
    }
  })

  it('效率随境界单调递减——越浅修越划算', () => {
    const rows = rebirthPoints()
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i]!.efficiency).toBeLessThan(rows[i - 1]!.efficiency)
    }
  })

  it('最优转世点就是门槛本身(金丹),不是玩家选出来的', () => {
    const best = optimalRebirthPoint()
    expect(best.major).toBe(MANUAL_REBIRTH_MIN_MAJOR)
    const worst = rebirthPoints()[rebirthPoints().length - 1]!
    expect(best.efficiency / worst.efficiency).toBeGreaterThan(100)
    console.log(
      `\n最优:${NAMES[best.major]}(效率 ${best.efficiency.toFixed(2)}),` +
        `最差:${NAMES[worst.major]}(${worst.efficiency.toFixed(3)})——相差 ${(best.efficiency / worst.efficiency).toFixed(0)} 倍`
    )
  })
})

describe('轮回 ROI · 边际账:再修一境值不值', () => {
  it('每一段的边际效率', () => {
    console.log('\n从→到       道果  时间成本    边际效率  占「重刷一轮金丹」')
    for (const r of marginalTable()) {
      console.log(
        `${NAMES[r.from]}→${NAMES[r.to]}  +${String(r.fruitGain).padStart(3)} ${r.hoursCost.toFixed(1).padStart(9)}h ` +
          `${r.marginal.toFixed(3).padStart(9)} ${(r.vsOptimal * 100).toFixed(1).padStart(8)}%`
      )
    }
  })

  it('从金丹再往上修一境,收益就只剩重刷一轮的三分之一', () => {
    const first = marginalTable()[0]!
    expect(first.from).toBe(MANUAL_REBIRTH_MIN_MAJOR)
    expect(first.vsOptimal).toBeLessThan(0.4)
    console.log(`\n${NAMES[first.from]}→${NAMES[first.to]}:边际效率仅为重刷一轮金丹的 ${(first.vsOptimal * 100).toFixed(1)}%`)
  })

  it('元婴之后深修的边际收益跌破一成半,深修在数值上毫无理由', () => {
    for (const r of marginalTable()) {
      if (r.from < 3) continue
      expect(r.vsOptimal).toBeLessThan(0.15)
    }
  })

  it('边际效率同样单调递减,不存在「修到某境界忽然划算」的拐点', () => {
    const rows = marginalTable()
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i]!.marginal).toBeLessThan(rows[i - 1]!.marginal)
    }
  })
})

describe('轮回 ROI · 结构成因', () => {
  it('道果二次增长而耗时指数增长,阶数不匹配', () => {
    const g = growthOrders()
    console.log(
      `\n金丹→真仙:道果 ×${g.fruitSpan.toFixed(1)},耗时 ×${g.hoursSpan.toFixed(0)}` +
        ` → 效率跌 ${g.efficiencyDrop.toFixed(0)} 倍`
    )
    expect(g.fruitSpan).toBeLessThan(15)
    expect(g.hoursSpan).toBeGreaterThan(1000)
    expect(g.efficiencyDrop).toBeGreaterThan(100)
  })

  it('两位真实玩家的落点都在效率曲线的高位段', () => {
    // 小黄鸭 27.2 枚/世(约元婴)、白望舒 87.0 枚/世(约合体)
    const rows = rebirthPoints()
    const best = optimalRebirthPoint()
    const yuanying = rows.find(r => r.major === 3)!
    const heti = rows.find(r => r.major === 6)!
    expect(yuanying.efficiency / best.efficiency).toBeGreaterThan(heti.efficiency / best.efficiency * 5)
    console.log(
      `\n小黄鸭(约元婴)效率 ${((yuanying.efficiency / best.efficiency) * 100).toFixed(0)}% ` +
        `vs 白望舒(约合体)${((heti.efficiency / best.efficiency) * 100).toFixed(0)}%——` +
        `前者每小时拿到的道果是后者的 ${(yuanying.efficiency / heti.efficiency).toFixed(0)} 倍`
    )
  })

  it('结论:高频轮回不是玩法偏好,是唯一的数值最优解', () => {
    const anyWorthDeepening = marginalTable().some(r => r.vsOptimal >= 1)
    expect(anyWorthDeepening).toBe(false)
  })
})

describe('轮回 ROI · 口径完整性', () => {
  it('耗时已计入突破失败重试与灵气等待,不只是修为累积', () => {
    // 修速倍率 progressionSim 已含;突破与灵气由 fullSecondsForMajor 补
    for (const m of [2, 5, 9]) {
      const full = fullSecondsForMajor(m)
      const bare = (() => {
        const mult = estimateCultMult(m, 0)
        let s = 0
        for (let sub = 0; sub < SUB_LEVELS; sub += 1) s += toNum(expRequirement(m, sub)) / (baseCultPerSec(m, sub) * mult)
        return s
      })()
      expect(full).toBeGreaterThan(bare)
      console.log(`\nmajor=${m}:纯修为 ${(bare / 3600).toFixed(1)}h → 计入突破与灵气 ${(full / 3600).toFixed(1)}h`)
    }
  })

  it('补齐漏项后结论不翻转:最优点仍是金丹', () => {
    expect(optimalRebirthPoint().major).toBe(MANUAL_REBIRTH_MIN_MAJOR)
    const g = growthOrders()
    // 实测跌幅 537 倍(人间每大境界净耗时 ×3.65)
    // 若要动,改道果曲线(DAO_FRUIT_PER_MAJOR / 软上限),修为需求不动(玩家明确要的)
    expect(g.efficiencyDrop).toBeGreaterThan(100)
    expect(g.efficiencyDrop).toBeLessThan(600)
  })
})
