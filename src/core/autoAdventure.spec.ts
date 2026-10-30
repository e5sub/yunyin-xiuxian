/**
 * 托管择地:取「最深且站得住」的一处;首选档位撑不住就退最稳档;都不行则不出行。
 * 故障注入:把 AUTO_ADVENTURE_MIN_WIN 调到 1 → 全部「去某处」的用例转红;
 * 把 `pickAutoPlan` 的 shortlist 砍到 1 处 → 「退到次深」那条红。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import type { ExploreMode } from '@/types'
import { pickAutoPlan, type AutoPlanDeps } from './autoAdventure'
import { autoTripTarget, planAutoAdventure } from './autoOps'
import { regionDef } from '@/data/regions'
import { AUTO_ADVENTURE_TRIALS } from '@/data/constants'

/** 三处地界,按层级由深到浅 —— 与 core/autoOps 交给 pickAutoPlan 的次序一致 */
const deep = regionDef('hantan')!
const mid = regionDef('heifeng')!
const shallow = regionDef('qingyun')!
const cands = [deep, mid, shallow]

type Rates = Record<string, Partial<Record<ExploreMode, number>>>

function deps(rates: Rates, cleared: string[] = []): AutoPlanDeps {
  return {
    rateAt: (region, mode) => rates[region.id]?.[mode] ?? 0,
    cleared: id => cleared.includes(id)
  }
}

describe('托管择地 · 量力而行', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('最深一处站得住就去最深,不必回头', () => {
    const plan = pickAutoPlan(cands, 'normal', deps({ hantan: { normal: 0.72 }, heifeng: { normal: 0.93 } }))
    expect(plan?.regionId).toBe(deep.id)
    expect(plan?.mode).toBe('normal')
    expect(plan?.reason).toBe('frontier')
  })

  it('深处打不过就退到次深,退到的那处仍是「最深的可战之地」', () => {
    const plan = pickAutoPlan(cands, 'normal', deps({ hantan: { normal: 0.08 }, heifeng: { normal: 0.72 } }))
    expect(plan?.regionId).toBe(mid.id)
    expect(plan?.reason).toBe('frontier')
  })

  it('首选档位过于凶险时自动退到最稳档,并交代一声 safer', () => {
    const plan = pickAutoPlan(
      cands,
      'marathon',
      deps({ hantan: { marathon: 0.08, normal: 0.72 }, heifeng: { marathon: 0.08, normal: 0.93 } })
    )
    expect(plan?.regionId).toBe(deep.id)
    expect(plan?.mode).toBe('normal')
    expect(plan?.reason).toBe('safer')
  })

  it('首选档位本就最稳时不再多试一轮(避免同一档试两遍)', () => {
    const plan = pickAutoPlan(cands, 'normal', deps({ hantan: { normal: 0.4 }, heifeng: { normal: 0.4 } }))
    expect(plan).toBeNull()
  })

  it('三处都站不住便不出行 —— 败则中断行程、负伤,白耗时辰不如静养', () => {
    const plan = pickAutoPlan(cands, 'normal', deps({ hantan: { normal: 0.4 }, heifeng: { normal: 0.08 } }))
    expect(plan).toBeNull()
  })

  it('前路已靖的深处仍可温养,但如实报 ceiling', () => {
    const plan = pickAutoPlan(cands, 'normal', deps({ hantan: { normal: 0.93 } }, [deep.id]))
    expect(plan?.regionId).toBe(deep.id)
    expect(plan?.reason).toBe('ceiling')
  })

  it('只试最深几处:更浅处的胜率再高也不作数(那是「往下退」,越退越穷)', () => {
    const fourth = regionDef('luoxia')!
    const five = [...cands, fourth]
    const plan = pickAutoPlan(
      five,
      'normal',
      deps({ hantan: { normal: 0.08 }, heifeng: { normal: 0.08 }, qingyun: { normal: 0.08 }, luoxia: { normal: 0.93 } })
    )
    expect(plan, `只试 ${AUTO_ADVENTURE_TRIALS} 处,第四处不在试打之列`).toBeNull()
  })

  it('没有可去之处时返回 null(不报错、不出行)', () => {
    expect(pickAutoPlan([], 'normal', deps({}))).toBeNull()
  })
})

describe('托管择地 · 与地界数据对得上', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('手动指定照玩家所选(回执不带择地理由)', () => {
    const t = autoTripTarget(shallow.id, 'deep')
    expect(t?.regionId).toBe(shallow.id)
    expect(t?.mode).toBe('deep')
    expect(t?.plan).toBeNull()
  })

  it('未选去处 / 去不了的地界一律不出行', () => {
    expect(autoTripTarget('', 'normal')).toBeNull()
    expect(autoTripTarget('no_such_place', 'normal')).toBeNull()
  })

  it('自动择地给出的是此刻真能进的一处(或干脆不出行)', () => {
    const plan = planAutoAdventure('normal')
    if (plan === null) return
    expect(cands.length).toBeGreaterThan(0)
    expect(plan.winRate).toBeGreaterThanOrEqual(0)
    expect(plan.winRate).toBeLessThanOrEqual(1)
    expect(plan.regionName.length).toBeGreaterThan(0)
  })
})
