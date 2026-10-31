/**
 * 周天七会的展示口径:星期名、达标判定、进度读数、赏格拆条。
 * 判定与读数的口径与「服务端 claim」一致(达标才亮领赏钮),此处不另设阈值。
 * 纯函数:灵石折算与灵草品阶由调用方按自身境界算好再拼文案。
 */
import type { DailyEventView, EventReward } from '@/services/cloud'

export const WEEKDAY_NAMES = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const

export function weekdayName(dow: number): string {
  return WEEKDAY_NAMES[dow] ?? ''
}

/** 今日是否达标:天榜看名次,其余看进度 */
export function eventDone(event: DailyEventView, progress: number, rank: number | null): boolean {
  if (event.kind === 'board') return rank !== null && rank > 0 && rank <= event.target
  return progress >= event.target
}

/** 进度标签 */
export function eventProgressLabel(event: DailyEventView): string {
  if (event.kind === 'board') return `天榜名次(前 ${event.target})`
  if (event.kind === 'arena') return '今日最好连胜'
  return '今日进度'
}

/** 进度读数;进度不越界显示(服务端可能记到超过目标) */
export function eventProgressValue(event: DailyEventView, progress: number, rank: number | null): string {
  if (event.kind === 'board') return rank === null || rank <= 0 ? '未上榜' : `第 ${rank} 名`
  return `${Math.max(0, Math.min(progress, event.target))} / ${event.target}`
}

export type RewardKey = 'stone' | 'wudao' | 'herb' | 'ore' | 'dust' | 'page'

/** 赏格拆成非零条目,顺序即界面顺序 */
export function eventRewardParts(r: EventReward): Array<{ key: RewardKey; n: number }> {
  const order: RewardKey[] = ['stone', 'wudao', 'herb', 'ore', 'dust', 'page']
  return order.filter(k => r[k] > 0).map(k => ({ key: k, n: r[k] }))
}
