import type { RatePart } from '@/core/breakthrough'
import { formatPercent, roundToSum } from '@/utils/format'

/** 修行页提示:疗伤、备药、突破门槛。卡片与 toast 同源;缕数与药资照实报 */
export function repairIdleToast(): string {
  return '周身无恙'
}

export function repairShortToast(shortText: string, qiText: string): string {
  return `灵气尚差 ${shortText} 缕 · 需 ${qiText} 缕`
}

export function repairDoneToast(qiText: string): string {
  return `伤势尽复 · 耗灵气 ${qiText}`
}

export function repairActLabel(affordable: boolean, qiText: string, shortText: string): string {
  return affordable ? `引气疗伤 · 耗灵气 ${qiText}` : repairShortToast(shortText, qiText)
}

export function prepPillShortToast(shortText: string): string {
  return `灵石尚差 ${shortText}`
}

/** 服聚气丹按钮欠资禁用说明,与备药 toast 同读一份石差 */
export function prepPillDisabledLabel(shortText: string): string {
  return `灵石尚差 ${shortText}`
}

export function breakthroughPeakReason(): string {
  return '已至大道尽头'
}

export function breakthroughExpReason(): string {
  return '修为未至圆满'
}

export function breakthroughQiReason(qiText: string): string {
  return `灵气不足 · 需 ${qiText} 缕`
}

export function breakthroughActLabel(needTribulation: boolean): string {
  return needTribulation ? '引劫突破' : '尝试突破'
}

export function breakthroughGoalText(near: boolean, needTribulation: boolean, targetLabel: string): string {
  if (!near) return `向「${targetLabel}」迈进`
  return `${breakthroughActLabel(needTribulation)}「${targetLabel}」`
}

/** 离线归来卷轴:小进阶不提劫 */
export function breakthroughReadyNote(needTribulation: boolean): string {
  return needTribulation ? '修为已至圆满 · 待渡劫' : '修为已至圆满'
}

/** 进阶成功率显示精度 0.1%;卡面率、来路各行、合计与配色同读一个取整值 */
const RATE_UNIT = 0.001
const RATE_GOOD = 0.7

export interface BreakthroughRateView {
  /** 取整后为 0 的行不列 */
  rows: RatePart[]
  text: string
  good: boolean
}

export function breakthroughRateView(parts: readonly RatePart[]): BreakthroughRateView {
  const shown = roundToSum(parts.map(p => p.value), RATE_UNIT)
  const units = Math.round(shown.reduce((a, b) => a + b, 0) / RATE_UNIT)
  return {
    rows: parts.map((p, i) => ({ label: p.label, value: shown[i] ?? 0 })).filter(r => Math.abs(r.value) > 1e-9),
    text: formatPercent(units * RATE_UNIT),
    good: units >= Math.round(RATE_GOOD / RATE_UNIT)
  }
}

// ---- 悟道兑换:灵石 → 悟道点 ----
export function exchangeOkToast(reward: number): string {
  return `悟道点 +${reward}`
}
export function exchangeFailText(lockedByRealm: boolean, dailyFull: boolean, stoneShortText: string): string {
  if (lockedByRealm) return '境界未到'
  if (dailyFull) return '今日已用尽'
  return `灵石尚差 ${stoneShortText}`
}
