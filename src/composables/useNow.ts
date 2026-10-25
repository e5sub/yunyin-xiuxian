/**
 * 每秒刷新的当前时间,供可冻结倒计时类 UI。
 * 读 `gameNow()`,与到期结算同一把尺:暂停时冻住,恢复后由引擎顺延各状态时间戳。
 */
import { ref, type Ref } from 'vue'
import { gameNow } from '@/core/enginePause'
import { useGameClock } from './useGameClock'

export function useNow(intervalMs = 1000): Ref<number> {
  const now = ref(gameNow())
  useGameClock(() => {
    now.value = gameNow()
  }, intervalMs)
  return now
}
