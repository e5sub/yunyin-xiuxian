/**
 * 法宝祭炼价目 —— 客户端价签、未登录本地链与服务端无头结算共用的一份(1.67.0 抽出)。
 *
 * 为什么单独成模块:祭炼此前整条链在客户端(core/forge 的 upgradeArtifact),价目也跟着住在那里;
 * 而 core/forge 顶部 import 了 audio/ui,服务端(Node)不能加载。祭炼收进 POST /api/progress/op
 * 之后,价目必须两边同源,故把它挪到这份无副作用的小模块里 —— 谁都不再各写一遍指数。
 *
 * 纯函数:不碰 store、不碰 RNG、不碰 UI。VIP 减免走 spendRate 的注入器(cutCount / cutGNum),
 * 与服务端同值。
 */
import type { ArtifactDef, GNum } from '@/types'
import { qualityDef } from '@/data/qualities'
import { ARTIFACT_MAX_LEVEL, ARTIFACT_UP_STONE_TIER, ARTIFACT_UP_WUDAO_BASE } from '@/data/artifacts'
import { stoneByTier } from './formulas'
import { cutCount, cutGNum } from './spendRate'

/** 该法宝从 level 升到 level+1 的价目;满重返回 null */
export function artifactUpCostAt(def: ArtifactDef, level: number): { wudao: number; stone: GNum } | null {
  const lv = Number.isFinite(level) ? Math.max(0, Math.floor(level)) : 0
  if (lv >= ARTIFACT_MAX_LEVEL) return null
  return {
    wudao: cutCount(
      Math.ceil(ARTIFACT_UP_WUDAO_BASE * Math.pow(1.6, lv) * (1 + qualityDef(def.quality).rank * 0.3))
    ),
    stone: cutGNum(stoneByTier(def.fromTier, ARTIFACT_UP_STONE_TIER * (1 + lv)))
  }
}
