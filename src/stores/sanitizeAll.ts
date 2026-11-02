/**
 * 逐仓字段级自愈的唯一入口:全部持久化分片(PERSISTED_STORES)hydrate 后各跑一遍 sanitize,
 * 修平坏档(JSON 合法但字段 NaN/undefined/负值)。
 *
 * 修仓清单与顺序只此一份,定义在 core/saveSanitize 的 SAVE_SANITIZE_STEPS:
 * 服务端落库前的归一化走同一张表,避免两边清单漂移。
 */
import { SAVE_SANITIZE_STEPS } from '@/core/saveSanitize'
import { useAuthStore } from '@/stores/auth'

/** 修的仓与顺序见 SAVE_SANITIZE_STEPS;调用方:main.ts 首次渲染前 / engine.start 离线结算前 */
export function sanitizeAllStores(): void {
  for (const step of SAVE_SANITIZE_STEPS) step.use().sanitize()
  // 会话态不在 PERSISTED_STORES 里(不进存档、不上传),客户端仍要清一次坏 token
  useAuthStore().sanitize()
}
