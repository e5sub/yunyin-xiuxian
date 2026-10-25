/**
 * 带引擎暂停守卫的游戏时钟:手写 setInterval 的收口处,心跳停着(重置 / 导入确认)时冻结。
 * 墙钟域不走这里:坊市货架 / 寄卖、悬赏换版、弟子跑腿按墙钟结算(离线照算),
 * MarketView / ApprenticeView 保留手写 `Date.now()` 的 interval。
 */
import { onMounted, onUnmounted } from 'vue'
import { enginePaused } from '@/core/enginePause'

/** 命令式:起一枚暂停可冻结的 interval,返回收表函数(回放/动画用) */
export function gameClock(cb: () => void, intervalMs = 1000): () => void {
  const timer = window.setInterval(() => {
    if (enginePaused.value) return
    cb()
  }, intervalMs)
  return () => window.clearInterval(timer)
}

/** 组合式:挂载即起表、卸载即收表(轮询类弹窗用) */
export function useGameClock(cb: () => void, intervalMs = 1000): void {
  let stop: (() => void) | undefined
  onMounted(() => {
    stop = gameClock(cb, intervalMs)
  })
  onUnmounted(() => stop?.())
}
