import type { QualityId } from '@/types'
import { qualityDef } from '@/data/qualities'

/**
 * 品阶三档视觉强度:凡/良/精、灵/玄/地、天/仙/神,档内一致、档间拉开。
 * 只决定浓淡;颜色单一事实源:data/qualities。
 */
export function qualityTierStyle(quality: QualityId): { border: number; bg: number } {
  const rank = qualityDef(quality).rank
  if (rank >= 6) return { border: 0.85, bg: 0.13 }
  if (rank >= 3) return { border: 0.55, bg: 0.1 }
  return { border: 0.33, bg: 0.06 }
}

/** 稀有档(天/仙/神),盖品阶角章 */
export function isRareQuality(quality: QualityId): boolean {
  return qualityDef(quality).rank >= 6
}

/** 按 rank 判三档强度;丹药「道品」不在 QualityId 联合里,rank 9 落稀有档 */
export function qualityTierByRank(rank: number): { border: number; bg: number } {
  if (!Number.isFinite(rank)) return { border: 0.33, bg: 0.06 }
  if (rank >= 6) return { border: 0.85, bg: 0.13 }
  if (rank >= 3) return { border: 0.55, bg: 0.1 }
  return { border: 0.33, bg: 0.06 }
}

/** rank 是否落在稀有档(天/仙/神/道);与 qualityTierByRank 同阈值 */
export function isRareRank(rank: number): boolean {
  return Number.isFinite(rank) && rank >= 6
}
