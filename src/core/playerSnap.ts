import type { ArtifactDef, CombatantSnap } from '@/types'
import { artifactDef } from '@/data/artifacts'
import { COMBO_SECONDARY_MIN, matchComboArt } from '@/data/comboArts'
import { usePlayerStore } from '@/stores/player'
import { useCultivationStore } from '@/stores/cultivation'
import { useInventoryStore } from '@/stores/inventory'
import { useEndgameStore } from '@/stores/endgame'
import { modOf } from './statsCalc'
import { detectBuild } from './buildDetect'
import { stackedMods, swordPurity, SWORD_LAYER_MODS } from './daoDepth'
import { hasActiveSet, ASTRAL_SET_SHIELD, ACCESSORY_SET_LIFESTEAL } from './equipSet'

/**
 * 构建玩家战斗快照。
 * celestial=true 走天界口径:装备词条先经 forgeSoul 凝为器魂,构筑方向保留、堆叠总量不算;
 * 基础三维不变(天界敌人按它等比缩放)。
 */
export function buildPlayerSnap(celestial = false): CombatantSnap {
  const player = usePlayerStore()
  const cultivation = useCultivationStore()
  const inventory = useInventoryStore()
  const endgame = useEndgameStore()
  const stats = celestial ? player.celestialStats : player.finalStats
  const artifacts = inventory.currentArtifacts
    .map(a => ({ def: artifactDef(a.defId), level: a.level }))
    .filter((x): x is { def: ArtifactDef; level: number } => x.def !== undefined)

  const build = detectBuild(stats.mods)
  // 流派组合技:主副体系凑对且副体系足够成形
  const comboArt =
    build?.secondary && build.secondary.affinity >= COMBO_SECONDARY_MIN
      ? (matchComboArt(build.style.id, build.secondary.style.id)?.id ?? undefined)
      : undefined
  // 剑道·剑意:道途越纯,剑意越盛(全局生效)
  let mods = stats.mods
  if (endgame.daoPath === 'sword') {
    const purity = swordPurity(stats.mods, artifacts.length, build)
    mods = stackedMods(stats.mods, SWORD_LAYER_MODS, purity.layers)
  }
  // astral 共鸣(同套 2 件):并入 shieldOnStart。不进 finalStats:机制钩子不改面板与流派检测
  if (hasActiveSet(inventory.equippedItems, 'astral')) {
    mods = stackedMods(mods, { shieldOnStart: ASTRAL_SET_SHIELD }, 1)
  }
  // 饰品三件套共鸣(妖庭):并入 lifesteal,不进 finalStats(与 astral 同法)
  if (hasActiveSet(inventory.equippedItems, 'peishi')) {
    mods = stackedMods(mods, { lifesteal: ACCESSORY_SET_LIFESTEAL }, 1)
  }

  return {
    name: player.name,
    icon: 'user',
    isPlayer: true,
    attack: stats.attack,
    defense: stats.defense,
    maxHp: stats.maxHp,
    speed: 1 + modOf(stats.mods, 'speed'),
    mods,
    skills: cultivation.mainSkill ? [cultivation.mainSkill] : [],
    artifacts,
    comboArt,
    // 铁壁共鸣(同套 2 件):首次致命伤保命
    ironwallBrace: hasActiveSet(inventory.equippedItems, 'ironwall')
  }
}
