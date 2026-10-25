/** 宿命传承能力位生效回归(纯函数,不起 Pinia):每个效果须是有界、平直的开关/额度,不随时间/世数漂移 */
import { describe, expect, it } from 'vitest'
import {
  birthMajorFloor,
  carriesAllLore,
  craftGuaranteeCrafts,
  craftGuaranteeRemaining,
  hasBreakExemption,
  keepsAllGongfa,
  talentChoiceBonus
} from './heritageEffects'

describe('宿命传承 · 能力位生效', () => {
  it('浴火丹心:本世三炉必成,用量逐炉递减,钳在 0 不越界、也不会负数', () => {
    expect(craftGuaranteeCrafts([])).toBe(0)
    expect(craftGuaranteeCrafts(['danxin'])).toBe(3)
    expect(craftGuaranteeRemaining(['danxin'], undefined)).toBe(3)
    expect(craftGuaranteeRemaining(['danxin'], { danxin: 0 })).toBe(3)
    expect(craftGuaranteeRemaining(['danxin'], { danxin: 2 })).toBe(1)
    expect(craftGuaranteeRemaining(['danxin'], { danxin: 3 })).toBe(0)
    expect(craftGuaranteeRemaining(['danxin'], { danxin: 99 })).toBe(0)
  })

  it('元婴凝实:出生起始境界下限抬到筑基(major 1);未持有则炼气(0)', () => {
    expect(birthMajorFloor([])).toBe(0)
    expect(birthMajorFloor(['danxin'])).toBe(0)
    expect(birthMajorFloor(['yuanying'])).toBe(1)
  })

  it('炼虚通感:转世择先天之姿多一个可选项;未持有多一选的额度为零', () => {
    expect(talentChoiceBonus([])).toBe(0)
    expect(talentChoiceBonus(['tonggan'])).toBe(1)
    // 只多一档,不随世数增长
    expect(talentChoiceBonus(['tonggan', 'tonggan'])).toBe(1)
  })

  it('大乘道统 / 渡劫跬步 / 真仙道痕:开关只在持有时为真', () => {
    expect(keepsAllGongfa([])).toBe(false)
    expect(keepsAllGongfa(['daotong'])).toBe(true)
    expect(hasBreakExemption([])).toBe(false)
    expect(hasBreakExemption(['dubu'])).toBe(true)
    expect(carriesAllLore([])).toBe(false)
    expect(carriesAllLore(['daoben'])).toBe(true)
  })
})
