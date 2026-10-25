/**
 * 逐仓字段级自愈的唯一入口:全部持久化分片(PERSISTED_STORES)hydrate 后各跑一遍 sanitize,
 * 修平坏档(JSON 合法但字段 NaN/undefined/负值)。
 */
import { usePlayerStore } from '@/stores/player'
import { useResourcesStore } from '@/stores/resources'
import { useLoreStore } from '@/stores/lore'
import { useDongfuStore } from '@/stores/dongfu'
import { useCultivationStore } from '@/stores/cultivation'
import { useInventoryStore } from '@/stores/inventory'
import { useQuestsStore } from '@/stores/quests'
import { useAdventureStore } from '@/stores/adventure'
import { useEndgameStore } from '@/stores/endgame'
import { useLoadoutsStore } from '@/stores/loadouts'
import { useSettingsStore } from '@/stores/settings'
import { useGameStore } from '@/stores/game'
import { useDiagStore } from '@/stores/diag'
import { useMarketStore } from '@/stores/market'
import { useApprenticeStore } from '@/stores/apprentice'
import { useBountyStore } from '@/stores/bounty'
import { usePacingTelemetry } from '@/stores/pacingTelemetry'

/** 修的仓与顺序只此一份;调用方:main.ts 首次渲染前 / engine.start 离线结算前(经 offline.sanitizeOfflineInputs) */
export function sanitizeAllStores(): void {
  usePlayerStore().sanitize()
  useResourcesStore().sanitize()
  useLoreStore().sanitize()
  useDongfuStore().sanitize()
  useCultivationStore().sanitize()
  useInventoryStore().sanitize()
  useQuestsStore().sanitize()
  useAdventureStore().sanitize()
  useEndgameStore().sanitize()
  useLoadoutsStore().sanitize()
  useSettingsStore().sanitize()
  useGameStore().sanitize()
  useDiagStore().sanitize()
  useMarketStore().sanitize()
  useApprenticeStore().sanitize()
  useBountyStore().sanitize()
  usePacingTelemetry().sanitize()
}
