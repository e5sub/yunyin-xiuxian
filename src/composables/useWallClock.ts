/**
 * 墙钟时钟:供暂停时也须照常推进的界面读数(坊市寄卖、悬赏换单、弟子跑腿,按墙钟结算)。
 * 游戏心跳域走 useNow / useGameClock;两者须分开,墙钟读数不进暂停守卫。
 */
import { onMounted, onUnmounted, ref, type Ref } from 'vue'

/** 命令式墙钟:每 tick 调一次 cb,返回收表函数 */
export function wallClock(cb: () => void, intervalMs = 1000): () => void {
  const timer = window.setInterval(cb, intervalMs)
  return () => window.clearInterval(timer)
}

/** 组合式墙钟读数:挂载起表、卸载收表,不读 enginePaused */
export function useWallNow(intervalMs = 1000): Ref<number> {
  const now = ref(Date.now())
  let stop: (() => void) | undefined
  onMounted(() => {
    stop = wallClock(() => {
      now.value = Date.now()
    }, intervalMs)
  })
  onUnmounted(() => stop?.())
  return now
}
