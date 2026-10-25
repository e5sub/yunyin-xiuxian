/**
 * 天时效果行;数字只从天时定义现算,界面不另写。
 * 风味短句不代替词条:赤阳不加火属,月蚀不加幽冥,雷鸣加攻击与渡劫难度。
 */
import { formatPercent } from '@/utils/format'
import type { WeatherDef } from '@/core/weather'
import { modsText } from '@/data/statNames'

/** 渡劫难度增减;倍率为 1 或非法时 null。效果行与渡劫栏同一口径 */
function tribulationDeltaText(w: WeatherDef): string | null {
  if (!Number.isFinite(w.tribulationMult) || w.tribulationMult === 1) return null
  const delta = w.tribulationMult - 1
  return `渡劫难度 ${delta > 0 ? '+' : '-'}${formatPercent(Math.abs(delta))}`
}

/** 今日实际加减;清和(空词条且渡劫倍率 1)报「无加减」 */
export function weatherEffectText(w: WeatherDef): string {
  const parts: string[] = []
  const mods = modsText(w.mods)
  if (mods) parts.push(mods)
  const trib = tribulationDeltaText(w)
  if (trib) parts.push(trib)
  return parts.length ? `今日:${parts.join(' · ')}` : '今日无加减'
}

/** 修行页渡劫栏;天威百分比须已乘入 tribulationMult */
export function weatherTribulationLine(w: WeatherDef): string | null {
  const trib = tribulationDeltaText(w)
  return trib ? `今日「${w.name}」 · ${trib}` : null
}
