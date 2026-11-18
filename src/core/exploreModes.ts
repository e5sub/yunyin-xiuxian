/**
 * 历练档位认读的唯一口径;档位表在 data/constants。
 * 会话按档位 id 存档,读档须先收回野 id:EXPLORE_MODES[野 id] 为 undefined,离线结算会出 NaN。
 * 按表的键判,新增档位自动放行。
 */
import { AUTO_MODE_ID, EXPLORE_MODES } from '@/data/constants'
import type { AutoModeChoice, ExploreMode } from '@/types'

/** 认得出的档位原样返回,野 id 归入「寻常游历」 */
export function exploreModeOf(raw: unknown): ExploreMode {
  return typeof raw === 'string' && raw in EXPLORE_MODES ? (raw as ExploreMode) : 'normal'
}

/**
 * 托管档位认读:'auto' 哨兵放行(自动选档),真档位原样,野值归「自动选档」。
 * 与 exploreModeOf 分立:会话档位认不出只能落最稳档,托管档位认不出则交给自动择优。
 */
export function autoModeOf(raw: unknown): AutoModeChoice {
  if (raw === AUTO_MODE_ID) return AUTO_MODE_ID
  return typeof raw === 'string' && raw in EXPLORE_MODES ? (raw as ExploreMode) : AUTO_MODE_ID
}
