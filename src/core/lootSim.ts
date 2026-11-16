/**
 * 装备经济压力测试:用真实掉落生成模拟长期挂机的装备洪流,量化背包压力与品质分布。
 * 基线模型,非玩家实况:不含 dropRate / luck / 双倍掉落 / 首领保底;胜率取共享的 TYPICAL_WIN_RATE(与 expIncome 同一假设,不另抄 0.85)。
 * 比值可用,绝对值不可用。
 */
import { mulberry32, RandomService } from '@/utils/random'
import { qualityDef, QUALITIES } from '@/data/qualities'
import { EQUIP_DROP_CHANCE, DECOMPOSE_DUST } from '@/data/constants'
import { bagCapacity } from '@/data/realms'
import { generateEquipment } from './equipGen'
import { winsPerHour } from './expIncome'

export interface LootPressure {
  tier: number
  dropsPerHour: number
  hoursToFillBag: number
  /** 按品质序号的占比(0~8) */
  rankShare: number[]
  avgRank: number
  /** 全部分解可得器灵尘/日 */
  dustPerDay: number
  dropsPer24h: number
  dropsPer7d: number
  dropsPer30d: number
}

/**
 * @param major 当前大境界:行囊格数随界抬(人间 120 → 本源 600),同一掉落速率下
 *              高界能装更久。默认 0(人间界),与旧读数逐位相同。
 */
export function simulateLootPressure(tier: number, major = 0, samples = 600): LootPressure {
  const rng = new RandomService(mulberry32(tier * 977))
  const rankCounts = new Array<number>(QUALITIES.length).fill(0)
  let dustSum = 0
  for (let i = 0; i < samples; i += 1) {
    const inst = generateEquipment(tier, rng)
    const rank = qualityDef(inst.quality).rank
    rankCounts[rank]! += 1
    dustSum += DECOMPOSE_DUST[rank] ?? 1
  }
  /*
   * 遭遇速率取 core/expIncome 的唯一口径 —— 原先这里把那个公式手写展开了一遍,
   * 与 winsPerHour() 逐项相同,只是没调它。
   * economySim 里那句注释说的就是这种形态:「此处另算会出现两套『全时历练 = ×N』读数」。
   */
  const dropsPerHour = winsPerHour() * EQUIP_DROP_CHANCE
  const avgRank = rankCounts.reduce((s, n, r) => s + n * r, 0) / samples
  return {
    tier,
    dropsPerHour,
    hoursToFillBag: bagCapacity(major) / dropsPerHour,
    rankShare: rankCounts.map(n => n / samples),
    avgRank,
    dustPerDay: (dustSum / samples) * dropsPerHour * 24,
    dropsPer24h: dropsPerHour * 24,
    dropsPer7d: dropsPerHour * 24 * 7,
    dropsPer30d: dropsPerHour * 24 * 30
  }
}
