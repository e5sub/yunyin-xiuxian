/**
 * 妖气复聚:够钟的已靖地界旧主归来(不再「已靖」),再靖一次即复位。
 * 只收回「已靖」,本世镇压资格保留;归来的首领按老规矩发(首领倍率 + 保底装备)并推进认知。
 * 钟的起点:worldMemory.regionTouchedAt(最后一次当地战斗、镇压、靖平,取最晚)。
 */
import { REGIONS, regionDef } from '@/data/regions'
import { useAdventureStore } from '@/stores/adventure'
import { usePlayerStore } from '@/stores/player'
import { useUiStore } from '@/stores/ui'
import { isRegionRevived, regionReviveClock } from './worldMemory'

/** 提示里最多点名几处 */
const LITANY_LIMIT = 3

/**
 * 结算妖气复聚:够钟的地界旧主归来且镇压随之松开。
 *
 * 由 settleSuppressedRegions 调用(在线每 tick 与离线结算同走这一处),
 * 须在「没有镇压就直接返回」之前(已靖却从不镇压的地界一份镇压都没有)。
 * 松闸与复聚只看 `regionTouchedAt` 一把钟,不另按 `suppressedSince` 判;播报也收在这一处,一片地界每 tick 至多被点名一次。
 *
 * @returns `returned` 旧主归来(已靖被收回);`loosened` 镇压松开(收益停下)。调用方(归来卷轴)须分别记账。
 */
export function settleRegionRevivals(
  now: number = Date.now()
): { returned: string[]; loosened: string[] } {
  const adventure = useAdventureStore()
  const player = usePlayerStore()
  const returned: string[] = []
  const loosened: string[] = []
  const doubled: string[] = []

  for (const region of REGIONS) {
    const clearedNow = adventure.cleared.includes(region.id)
    const suppressedNow = player.suppressedRegions.includes(region.id)
    if (!clearedNow && !suppressedNow) continue
    const touchedAt = regionReviveClock(region.id)
    if (!isRegionRevived(touchedAt, now)) continue
    // 镇压松开,资格仍在
    if (suppressedNow) {
      player.loosenSuppression(region.id)
      loosened.push(region.id)
    }
    if (clearedNow) {
      adventure.markRevived(region.id)
      returned.push(region.id)
    }
    if (clearedNow && suppressedNow) doubled.push(region.id)
  }

  if (doubled.length > 0) {
    useUiStore().toast(`${litany(doubled)}旧主归来 · 镇压松开`, 'info')
  }
  const returnedOnly = returned.filter(id => !doubled.includes(id))
  const loosenedOnly = loosened.filter(id => !doubled.includes(id))
  if (returnedOnly.length > 0) {
    useUiStore().toast(`${litany(returnedOnly)}旧主归来`, 'info')
  }
  if (loosenedOnly.length > 0) {
    useUiStore().toast(`${litany(loosenedOnly)}镇压松开`, 'info')
  }
  return { returned, loosened }
}

/** 点名几处,多了就报个数 */
function litany(ids: string[]): string {
  const names = ids.map(id => regionDef(id)?.name ?? id)
  const head = names.slice(0, LITANY_LIMIT).join('、')
  return names.length > LITANY_LIMIT ? `${head} 等 ${names.length} 处` : head
}
