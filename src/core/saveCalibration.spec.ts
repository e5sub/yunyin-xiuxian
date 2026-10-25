/* eslint-disable no-console */
/**
 * 真实存档校准:progressionSim.hoursToReach 耗时模型比真实存档高估约 400 倍
 * (模型只算纯修为累积;真实修为大部分来自战斗、事件、丹药、离线收益)。
 * 基于耗时模型的结论须先过这里的量级检查;改修行曲线时这里显示与真实玩家的偏离。
 * 存档含玩家数据不入库,只固化提取的统计量。
 */
import { describe, expect, it } from 'vitest'
import { daoFruitGain } from './formulas'
import { hoursToPeakAt } from './samsaraAudit'

/** 真实存档统计量:取自 2026-09-01 与 2026-09-03 两份导出档,均为真仙圆满 */
export interface SaveSample {
  name: string
  /** 实际游玩小时(totalPlaySec) */
  playHours: number
  /** 创建到最后活跃的真实时长 */
  wallHours: number
  /** 已轮回世数 */
  reincarnations: number
  daoFruit: number
  talents: number
  /** 行为计数 */
  battles: number
  breakthroughs: number
  explores: number
  offlineClaims: number
}

export const SAMPLES: SaveSample[] = [
  {
    name: '小黄鸭',
    playHours: 22.7,
    wallHours: 29.9,
    reincarnations: 17,
    daoFruit: 463,
    talents: 33,
    battles: 6182,
    breakthroughs: 543,
    explores: 151,
    offlineClaims: 12
  },
  {
    name: '白望舒',
    playHours: 38.1,
    wallHours: 66.0,
    reincarnations: 4,
    daoFruit: 348,
    talents: 11,
    battles: 7948,
    breakthroughs: 259,
    explores: 71,
    offlineClaims: 33
  }
]

function hoursPerLife(s: SaveSample): number {
  return s.playHours / (s.reincarnations + 1)
}

/** 由每世平均道果反推转世时的大境界 */
function transmigrateMajor(s: SaveSample): number {
  const per = s.daoFruit / Math.max(1, s.reincarnations)
  for (let m = 0; m <= 9; m += 1) if (daoFruitGain(m, 9) >= per) return m
  return 9
}

describe('存档校准 · 真实节奏', () => {
  it('两份样本的实际节奏', () => {
    console.log('\n真实存档(均已修满真仙圆满):')
    for (const s of SAMPLES) {
      console.log(
        `  ${s.name}:${s.playHours}h / ${s.reincarnations + 1} 世 = 每世 ${hoursPerLife(s).toFixed(2)}h · ` +
          `道果 ${(s.daoFruit / s.reincarnations).toFixed(1)}/世(约 major ${transmigrateMajor(s)} 转世)· ` +
          `天赋 ${s.talents} 项 · 离线占 ${(((s.wallHours - s.playHours) / s.wallHours) * 100).toFixed(0)}%`
      )
    }
  })

  it('走完一世的真实量级是「小时」,不是「百小时」', () => {
    for (const s of SAMPLES) {
      const h = hoursPerLife(s)
      expect(h).toBeGreaterThan(0.5)
      expect(h).toBeLessThan(20)
    }
  })

  it('玩家不会每世都修满真仙——道果反推的转世境界远低于九', () => {
    // 耗时模型按「每世修满真仙」计;实际元婴到合体之间就转世
    for (const s of SAMPLES) {
      const m = transmigrateMajor(s)
      expect(m).toBeGreaterThanOrEqual(3)
      expect(m).toBeLessThanOrEqual(7)
    }
  })

  it('两种玩法路径差异极大,不能用单一节奏描述轮回', () => {
    const [fast, slow] = SAMPLES
    expect(fast!.reincarnations).toBeGreaterThan(slow!.reincarnations * 3)
    // 实际每世耗时相差六倍
    expect(hoursPerLife(slow!)).toBeGreaterThan(hoursPerLife(fast!) * 4)
    console.log(
      `\n路径分化:${fast!.name} 每世 ${hoursPerLife(fast!).toFixed(2)}h × ${fast!.reincarnations + 1} 世` +
        ` vs ${slow!.name} 每世 ${hoursPerLife(slow!).toFixed(2)}h × ${slow!.reincarnations + 1} 世`
    )
  })
})

describe('存档校准 · 耗时模型的偏差', () => {
  it('progressionSim 高估两个数量级——凡引用其绝对值的结论一律作废', () => {
    for (const s of SAMPLES) {
      const lives = s.reincarnations + 1
      let modeled = 0
      for (let n = 1; n <= lives; n += 1) modeled += hoursToPeakAt(n)
      const ratio = modeled / s.playHours
      console.log(`\n${s.name}:模型 ${modeled.toFixed(0)}h vs 实际 ${s.playHours}h → 高估 ${ratio.toFixed(0)} 倍`)
      expect(ratio).toBeGreaterThan(50)
    }
  })

  it('模型自己就声明了不可靠,只是幅度远超注释所说的 1.5~3 倍', () => {
    // progressionSim 头注称真实耗时约为估算的 1.5~3 倍;实际方向相反,远低于估算
    const s = SAMPLES[0]!
    let modeled = 0
    for (let n = 1; n <= s.reincarnations + 1; n += 1) modeled += hoursToPeakAt(n)
    expect(modeled).toBeGreaterThan(s.playHours * 3)
  })

  it('修为的主要来源是战斗与离线,不是静坐攒时间', () => {
    for (const s of SAMPLES) {
      const battlesPerHour = s.battles / s.playHours
      expect(battlesPerHour).toBeGreaterThan(150)
      console.log(`\n${s.name}:每小时 ${battlesPerHour.toFixed(0)} 场战斗、${(s.breakthroughs / s.playHours).toFixed(1)} 次突破`)
    }
  })

  it('离线占比可观,进一步说明「在线时长」不是进度的量尺', () => {
    for (const s of SAMPLES) {
      const offlineShare = (s.wallHours - s.playHours) / s.wallHours
      expect(offlineShare).toBeGreaterThan(0.2)
    }
  })
})

describe('存档校准 · 对既有结论的影响', () => {
  it('仍然成立:道果无界而天赋有界,快档已集满 33 项', () => {
    const fast = SAMPLES[0]!
    expect(fast.talents).toBe(33)
    expect(fast.daoFruit).toBeGreaterThan(400)
  })

  it('作废:任何「第 N 世需要 X 小时」的绝对结论', () => {
    // 保留此用例:审计模块若再输出绝对时长,须先过存档校准
    const s = SAMPLES[0]!
    const modeled = hoursToPeakAt(1)
    // 模型第一世 1730h;玩家十八世共 22.7h
    expect(modeled).toBeGreaterThan(s.playHours * 50)
  })

  it('道果实际积累速度远低于模型假设', () => {
    for (const s of SAMPLES) {
      const modeledFruit = s.reincarnations * daoFruitGain(9, 9)
      expect(s.daoFruit).toBeLessThan(modeledFruit)
      console.log(`\n${s.name}:实际道果 ${s.daoFruit} vs 模型假设 ${modeledFruit}(按每世修满真仙计)`)
    }
  })
})
