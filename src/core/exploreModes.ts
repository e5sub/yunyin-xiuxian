/**
 * 历练档位认读的唯一口径;档位表在 data/constants。
 * 会话按档位 id 存档,读档须先收回野 id:EXPLORE_MODES[野 id] 为 undefined,离线结算会出 NaN。
 * 按表的键判,新增档位自动放行。
 */
import { EXPLORE_MODES } from '@/data/constants'
import type { ExploreMode } from '@/types'

/** 认得出的档位原样返回,野 id 归入「寻常游历」 */
export function exploreModeOf(raw: unknown): ExploreMode {
  return typeof raw === 'string' && raw in EXPLORE_MODES ? (raw as ExploreMode) : 'normal'
}
