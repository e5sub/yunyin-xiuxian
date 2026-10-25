/**
 * 心跳暂停的墙上时钟:暂停(重置 / 导入确认窗)期间「现在」冻住。
 * 独立成模块:不形成 engine → earlyGameService → engine 循环依赖。
 * - 可冻结的到期判定读 gameNow(),不读 Date.now();
 * - 恢复时由 engine.resume 把暂停时长补回各条墙上时钟;
 * - 墙钟域(坊市货架、悬赏换版、弟子跑腿)不走这里,暂停时照常结算。
 */
import { readonly, ref } from 'vue'

const pausedRef = ref(false)
let pauseStartedAt = 0

export const enginePaused = readonly(pausedRef)

/** 进入 / 退出暂停。重复进入不重置冻结点(幂等) */
export function setEnginePaused(value: boolean): void {
  if (value) {
    if (!pausedRef.value) pauseStartedAt = Date.now()
    pausedRef.value = true
    return
  }
  pausedRef.value = false
  pauseStartedAt = 0
}

/** 游戏内可冻结的「现在」:暂停时停在暂停那一刻,恢复后回到真实时钟 */
export function gameNow(): number {
  return pausedRef.value && pauseStartedAt > 0 ? pauseStartedAt : Date.now()
}

/** 已暂停多久(毫秒);未暂停返回 0 */
export function pauseElapsedMs(now = Date.now()): number {
  if (!pausedRef.value || pauseStartedAt <= 0) return 0
  return Math.max(0, now - pauseStartedAt)
}
