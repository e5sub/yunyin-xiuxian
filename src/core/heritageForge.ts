/**
 * 宿命传承锻造生命周期。只算不改(同 reincarnation.ts):落账在 confirmReincarnation 的 forgedHeritage 提交;不写资源流。
 * 防浅修三道闸:
 *   ① 门槛:只锻造 `gateMajor <= 本世所达境界` 的传承,金丹(major 2)以下永远返回空;
 *   ② 一世至多一悟:只锻造最高那一个;
 *   ③ 永久持有:入 `player.reincarnation.heritage`,跨世不清零,重复锻造(旧档残留/重复触发)被 addHeritage 忽略。
 */
import { HERITAGE_DEFS, type HeritageDef, type HeritageId } from '@/data/heritage'
import { usePlayerStore } from '@/stores/player'

/** 已锻造的传承 id(跨世永久) */
export function ownedHeritage(): HeritageId[] {
  return usePlayerStore().reincarnation.heritage
}

/** 候选:gateMajor <= major 且尚未锻造的传承,按门槛升序 */
export function forgeCandidate(major: number): HeritageDef[] {
  const owned = new Set(ownedHeritage())
  return HERITAGE_DEFS.filter(d => d.gateMajor <= major && !owned.has(d.id)).sort(
    (a, b) => a.gateMajor - b.gateMajor
  )
}

/** 取本世到达的最高未锻造门槛;无候选为 null */
export function lifeForge(major: number): HeritageDef | null {
  const cands = forgeCandidate(major)
  return cands.length > 0 ? cands[cands.length - 1]! : null
}
