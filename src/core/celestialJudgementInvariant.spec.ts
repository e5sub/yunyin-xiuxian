/**
 * 天道判定(celestialJudgement)反极端堆叠护栏(FIX 3)。
 *
 * REVIEW:celestialJudgement 按「构筑深度 / 基准 2.6」加厚终局敌人,并在越过基准后
 * 对敌方增伤/减伤各加至多 +35% —— 于是极端 min-max 堆叠(depth ~4.76)面对
 * ~×1.83 加厚 + ~12.5% 判定,净效应反而为负,即「堆过头被罚」。这是**有意**的
 * 反极端设计,不是事故:
 *
 *   - 六大标准流派(buildSim)的构筑深度为 1.02~2.43,**全部低于基准 2.6**,理应
 *     **完全不受罚**(thicken=1、判定增伤/减伤≈0)—— 否则标准构筑反被加厚,
 *     「可行流派≥3」的天界平衡门会被误伤。
 *   - 只有真正越过基准的超额堆叠才被**阻尼**:加厚 >1,增伤/减伤按 JUDGE_RATE
 *     递增并在 JUDGE_CAP 封顶 —— 既让它难缠,又不让它变成绝对打不动。
 *
 * 这里把「标准不罚、极端阻尼」编码为不变式:只要让标准构筑开始被罚、或让极端
 * 堆叠失去阻尼(封顶失效 / JUDGE_RATE 静默改成一刀切),本 spec 即红。维护者据此
 * 知道这层反 minmax 是有意为之的,不能静默移除。
 */
import { describe, expect, it } from 'vitest'
import { BUILD_PROFILES, buildSnap } from './buildSim'
import { modDepth } from './statsCalc'
import {
  CELESTIAL_BASE_DEPTH,
  CELESTIAL_JUDGE_RATE,
  CELESTIAL_JUDGE_CAP,
  celestialDepthScale,
  celestialJudgement
} from './gauntlet'
import type { StatMods } from '@/types'

/** 境界已到锚点境界(20) —— 无境界压制,只隔离「道之理解」这一维 */
const AT_ANCHOR = 20

describe('天道判定不变式 · 标准构筑不罚、极端堆叠阻尼', () => {
  it('六大标准流派全部低于基准深度 —— 属于正常构筑', () => {
    for (const p of BUILD_PROFILES) {
      const depth = modDepth(buildSnap(p).mods)
      // 文档记录的流派深度带 1.02~2.43;真正的硬判据是「低于基准」。
      expect(depth, `${p.name} 深度应小于基准 ${CELESTIAL_BASE_DEPTH}`).toBeLessThan(CELESTIAL_BASE_DEPTH)
    }
  })

  it('标准流派完全不受罚:加厚=1,增伤/减伤=0(不触发判定)', () => {
    for (const p of BUILD_PROFILES) {
      const mods = buildSnap(p).mods
      // 加厚系数:低于基准必须恒为 1 —— 浅构筑不能反被削。
      expect(celestialDepthScale(mods), `${p.name} 深度低于基准,加厚系数必须为 1`).toBe(1)
      // 判定:标准构筑不应有任何增伤/减伤 —— 它就是「该有的样子」。
      const j = celestialJudgement(mods, AT_ANCHOR, AT_ANCHOR)
      expect(j.thicken, `${p.name} 判定加厚应为 1`).toBe(1)
      expect(j.damageBonus, `${p.name} 不应有增伤`).toBe(0)
      expect(j.damageReduction, `${p.name} 不应有减伤`).toBe(0)
      expect(j.suppressed, `${p.name} 无境界压制`).toBe(false)
    }
  })

  it('极端堆叠被阻尼:越过基准 → 加厚>1,增伤/减伤按 JUDGE_RATE 递增且封顶', () => {
    // 实测真仙常规档深度 4.76 —— 代表「堆过头」的那一头。
    const EXTREME: StatMods = { critRate: 4.76 }
    const depth = modDepth(EXTREME)
    expect(depth).toBeGreaterThan(CELESTIAL_BASE_DEPTH)

    const scale = celestialDepthScale(EXTREME)
    expect(scale, '越过基准必须被加厚(>1)').toBeGreaterThan(1)

    const j = celestialJudgement(EXTREME, AT_ANCHOR, AT_ANCHOR)
    // 增伤=减伤,按 (加厚-1)×JUDGE_RATE,落在 (0, CAP] 之间 —— 被阻尼但封顶。
    const over = scale - 1
    const expectedJudge = Math.min(CELESTIAL_JUDGE_CAP, over * CELESTIAL_JUDGE_RATE)
    expect(j.damageBonus).toBeCloseTo(expectedJudge, 5)
    expect(j.damageReduction).toBeCloseTo(expectedJudge, 5)
    expect(j.damageBonus).toBeGreaterThan(0)
    expect(j.damageBonus).toBeLessThanOrEqual(CELESTIAL_JUDGE_CAP)
  })

  it('阻尼封顶恒生效:堆得再深,增伤/减伤也不越过 JUDGE_CAP', () => {
    // 深不见底的堆叠 → 判定必须被 JUDGE_CAP 压住,证明「封顶」不是摆设。
    const DEEP: StatMods = { critRate: 1e6 }
    const j = celestialJudgement(DEEP, AT_ANCHOR, AT_ANCHOR)
    expect(j.damageBonus, '增伤在极端深度下必须封顶').toBe(CELESTIAL_JUDGE_CAP)
    expect(j.damageReduction, '减伤在极端深度下必须封顶').toBe(CELESTIAL_JUDGE_CAP)
  })
})
