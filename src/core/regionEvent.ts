/** 区域动态事件:区域临时进入异常状态(改变敌人组成/掉落/生态),低频、自动过期 */
import { usePlayerStore } from '@/stores/player'
import { rng } from '@/utils/random'
import type { RegionDef } from '@/types'
import { gameNow } from './enginePause'
import { REGION_EVENTS, regionEventDef, type RegionEventDef, type RegionEventId } from '@/data/regionEvents'

export interface RegionEventState {
  regionId: string
  eventId: RegionEventId
  /** 结束时间戳 */
  endsAt: number
}

// 事件表放 data/:player store 校验 id 时不反向依赖本模块(会成环)
export { REGION_EVENTS, regionEventDef }
export type { RegionEventDef, RegionEventId }

/** 事件持续时间(分钟,30~120) */
const DURATION_MIN = [30, 60, 90, 120] as const

/** 当前生效的区域事件;过期即清理 */
export function currentRegionEvent(regionId: string): RegionEventState | null {
  const player = usePlayerStore()
  // gameNow() 暂停时冻住:确认窗背后不耗区域事件
  const now = gameNow()
  const ev = player.regionEvent
  if (!ev || ev.regionId !== regionId) return null
  if (ev.endsAt <= now) {
    player.setRegionEvent(null)
    return null
  }
  return ev
}

/** 尝试为某区域生成一次事件(低频:引擎周期性调用,按概率) */
export function rollRegionEvent(region: RegionDef): RegionEventState | null {
  const player = usePlayerStore()
  // 可冻结域:`regionEvent.endsAt` 由 `player.shiftTimedState` 顺延;须与 `currentRegionEvent` 同读游戏时钟
  const now = gameNow()
  const cur = player.regionEvent
  if (cur && cur.endsAt > now) return null
  // 每小时约一次(引擎 30s 周期 → 约 0.85% / 检查)
  if (!rng.chance(0.0085)) return null
  const eventId = rng.pick(REGION_EVENTS.map(e => e.id))
  const durationMin = rng.pick(DURATION_MIN) ?? 60
  const state: RegionEventState = {
    regionId: region.id,
    eventId,
    endsAt: now + durationMin * 60_000
  }
  player.setRegionEvent(state)
  return state
}
