/**
 * 命格 —— 紫微十二宫的一世之格(与问卦的分工见 data/ziwei)
 * 不落状态、不耗资源、不给时限:由灵根与转世数确定性推出,同人同世同盘,转世重算。
 * 不是真排盘(游戏内无生辰):按灵根与轮回归属安星,只取十二宫与十四主星的象义。
 */
import type { LinggenProfile, StatMods } from '@/types'
import { PALACES, STARS, type PalaceDef, type StarDef } from '@/data/ziwei'
import { STAR_FOCUS_MULT } from '@/data/constants'
import { mulberry32 } from '@/utils/random'
import { mergeMods } from './statsCalc'

export interface FatePalace {
  palace: PalaceDef
  /** 此宫所落主星(可能有两颗) */
  stars: StarDef[]
}

export interface FateChart {
  /** 命宫主星(题眼) */
  lord: StarDef
  palaces: FatePalace[]
}

/** 由灵根与转世数推出安星种子:同灵根者不必同命,灵根一变(转世重掷)种子必变 */
export function fateSeed(linggen: LinggenProfile | null | undefined, lifeCount: number): number {
  const roots = linggen?.roots ?? []
  // 用资质(30~100)而非比例(SpiritRoot 只有 element/aptitude);灵根次序有意义
  const rootPart = roots.reduce((acc, r, i) => acc + (Number.isFinite(r.aptitude) ? r.aptitude : 0) * (i + 1), 0)
  const countPart = Math.max(0, Math.floor(lifeCount)) * 1_000_003
  return Math.floor(rootPart * 7919) + countPart + roots.length * 13 + 1
}

/** 安星:十四主星依序布入十二宫;不取吉凶四化,只取星性 */
export function fateChart(seed: number): FateChart {
  const rand = mulberry32(seed)
  const start = Math.floor(rand() * PALACES.length)
  const offset = Math.floor(rand() * STARS.length)
  const palaces: FatePalace[] = PALACES.map(palace => ({ palace, stars: [] as StarDef[] }))

  // 各宫先得一星,余下两星归命宫与迁移宫(命宫之对宫)
  const order = STARS.map((_, i) => STARS[(i + offset) % STARS.length]!)
  let k = 0
  for (let i = 0; i < PALACES.length; i += 1) {
    palaces[(start + i) % PALACES.length]!.stars.push(order[k++]!)
  }
  for (const idx of [0, 6]) {
    palaces[idx]!.stars.push(order[k++]!)
  }

  const lord = palaces.find(p => p.palace.id === 'ming')?.stars[0] ?? STARS[0]!
  return { lord, palaces }
}

/** 十二宫各星之力相合(数值刻意低) */
export function fateMods(chart: FateChart): StatMods {
  return mergeMods(chart.palaces.flatMap(p => p.stars.map(s => s.mods)))
}

/**
 * 点化主星:选中主星之力 × STAR_FOCUS_MULT,其余十三颗原值。
 * 不变式:只读命盘、不改布星;focusStarId 是存档状态,同人同世同 focus 必同果;单通道 <0.2(单星至多 0.03,×2 后 0.06)。
 * 认不出的 focusStarId(不在命盘/已损坏)按无焦点处理。
 */
export function fateFocusMods(chart: FateChart, focusStarId: string | null): StatMods {
  const exists = focusStarId !== null && chart.palaces.some(p => p.stars.some(s => s.id === focusStarId))
  if (!exists) return fateMods(chart)
  const parts: StatMods[] = []
  for (const palace of chart.palaces) {
    for (const star of palace.stars) {
      const m: StatMods = {}
      const mult = star.id === focusStarId ? STAR_FOCUS_MULT : 1
      for (const k of Object.keys(star.mods) as (keyof StatMods)[]) m[k] = (star.mods[k] ?? 0) * mult
      parts.push(m)
    }
  }
  return mergeMods(parts)
}

/** 命宫所落之星(展示用):题眼与同宫者 */
export function fateLordLine(chart: FateChart): string {
  const mine = chart.palaces.find(p => p.palace.id === 'ming')!
  const names = mine.stars.map(s => `${s.name}(${s.nature})`).join('、')
  return `命宫落${names} —— ${mine.stars[0]!.gist}`
}

