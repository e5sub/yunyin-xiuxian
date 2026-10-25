import { describe, expect, it } from 'vitest'
import { enemyDef } from '@/data/enemies'
import { regionDef, REGIONS } from '@/data/regions'
import { ecologyChips, enemyTraits, recommendForRegion, regionEcology, styleAdaptation } from './buildAdvisor'

describe('Build 决策层(区域生态与适配)', () => {
  it('敌人特性由正式数据自动判定', () => {
    expect(enemyTraits(enemyDef('e_brokensword')!)).toContain('pierce')
    expect(enemyTraits(enemyDef('e_zeagle')!)).toContain('multi')
    expect(enemyTraits(enemyDef('e_fox')!)).toContain('dodge')
    expect(enemyTraits(enemyDef('e_wolf')!)).toEqual([])
  })

  it('新手区生态干净,后期区生态复杂', () => {
    const qingyun = regionEcology(regionDef('qingyun')!)
    expect(Object.values(qingyun).every(v => v === 0)).toBe(true)
    const jianzhong = regionEcology(regionDef('jianzhong')!)
    expect(jianzhong.pierce).toBeGreaterThanOrEqual(2)
    const leize = regionEcology(regionDef('leize')!)
    expect(leize.multi).toBeGreaterThanOrEqual(2)
  })

  it('适配评级遵循克制矩阵:真伤压制罡盾,多段喂养反震', () => {
    const pierceHeavy = { burst: 0 as const, multi: 0 as const, pierce: 3 as const, dodge: 0 as const }
    expect(styleAdaptation('gangdun', pierceHeavy).stars).toBeLessThan(3)
    expect(styleAdaptation('beishui', pierceHeavy).stars).toBeGreaterThan(3)
    const leize = regionEcology(regionDef('leize')!)
    expect(styleAdaptation('fanzhen', leize).stars).toBeGreaterThan(3)
    // 首领战:背水占优,连击吃亏
    const neutral = regionEcology(regionDef('qingyun')!)
    expect(styleAdaptation('beishui', neutral, true).stars).toBeGreaterThan(styleAdaptation('lianji', neutral, true).stars)
  })

  it('推荐带评级与理由,而非单一答案', () => {
    const recs = recommendForRegion(regionDef('jianzhong')!)
    expect(recs.length).toBe(6)
    expect(recs[0]!.adaptation.stars).toBeGreaterThanOrEqual(recs[5]!.adaptation.stars)
    expect(recs.some(r => r.adaptation.reasons.length > 0)).toBe(true)
  })

  it('每个区域都能推导生态且不越界', () => {
    for (const region of REGIONS) {
      const eco = regionEcology(region)
      for (const v of Object.values(eco)) {
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(3)
      }
      const chips = ecologyChips(eco)
      expect(chips.length).toBeLessThanOrEqual(4)
    }
  })
})
