/**
 * 星象值日:二十八宿轮值,只利一方界域(四象配四界,见 data/xiangxiu);天时才影响所有地方。
 * 确定性:由游戏总秒数派生,同一游戏日固定,无现实时间依赖。
 */
import { useGameStore } from '@/stores/game'
import { usePlayerStore } from '@/stores/player'
import { gameDay } from './formulas'
import { MANSIONS, imageDef, type MansionDef } from '@/data/xiangxiu'
import { regionDef } from '@/data/regions'
import { WORLDS, worldOf } from '@/data/realms'
import { MANSION_EVENT_LUCK } from '@/data/constants'
import type { WorldId } from '@/types'
import type { MansionRedirect } from './mansionRedirect'

export type { MansionRedirect } from './mansionRedirect'

/** 游戏日 → 值日之宿(28 日一轮) */
export function mansionOfDay(day: number): MansionDef {
  const idx = ((Math.floor(day) % MANSIONS.length) + MANSIONS.length) % MANSIONS.length
  return MANSIONS[idx]!
}

export function todayMansion(): MansionDef {
  return mansionOfDay(currentGameDay())
}

/** 当前游戏日(秒 → 日),固定口径一处出 */
export function currentGameDay(): number {
  return gameDay(useGameStore().totalPlaySec)
}

/** 此宿所利之界域 */
export function favoredWorld(mansion: MansionDef): WorldId {
  return imageDef(mansion.image)?.world ?? 'mortal'
}

/**
 * 玩家今日的定向覆盖:生效返回其界域,否则 null(调用方回落到天数派生)。
 * 当日改满 MANSION_REDIRECT_MAX 只是不再允许继续改向,不撤销已生效的定向。
 */
export function activeRedirectWorld(day: number, redirect: MansionRedirect | null): WorldId | null {
  if (!redirect) return null
  if (redirect.gameDay !== day) return null
  if (redirect.count < 1) return null
  if (!WORLDS.some(w => w.id === redirect.worldId)) return null
  return redirect.worldId
}

export function currentRedirect(): MansionRedirect | null {
  return usePlayerStore().mansionRedirect
}

/** 今日所利界域:有生效定向走定向,否则走天数派生;展示与判定共用这一枚 */
export function effectiveFavoredWorld(): WorldId {
  return activeRedirectWorld(currentGameDay(), currentRedirect()) ?? favoredWorld(todayMansion())
}

export function isFavoredRegion(regionId: string): boolean {
  const region = regionDef(regionId)
  if (!region) return false
  return effectiveFavoredWorld() === worldOf(region.minRealm).id
}

/** 星象给此地的际遇加成;值日之宿不加全局数值(否则就成了第二个天时) */
export function mansionEventLuck(regionId: string): number {
  return isFavoredRegion(regionId) ? MANSION_EVENT_LUCK : 0
}

/** 星象加成的展示百分数;三处页面/文案共用,不各算各的 */
export function mansionLuckPercent(): number {
  return Math.round(MANSION_EVENT_LUCK * 100)
}

/** 今日星象一句话,展示层直接用,不另写一份;所宜(m.good)均以「宜」开头,不再另加 */
export function todayMansionLine(): string {
  const m = todayMansion()
  const img = imageDef(m.image)
  return `${m.fullName}直日 · ${img?.name ?? ''}${img?.direction ?? ''}方 · 分野${m.domain} · ${m.good}`
}
