/**
 * 凡界生成 · 主观新颖度代理审计
 * 结构新颖 ≠ 玩家感知新颖:按玩家可见特征度量,排除「明显换皮」。
 */
import { MUTATOR_THEMES, THEME_IDENTITY, type MutatorTheme } from '@/data/mutators'
import { REGIONS } from '@/data/regions'
import { enemyDef } from '@/data/enemies'
import { type MortalWorld, mortalNovelty } from './mortalWorldGen'

// ============ 一、世界身份 ============

/** 地貌轴:由地界 icon 归类 */
export type TerrainAxis = '山岳' | '林泽' | '火域' | '天象' | '废墟' | '幽冥'

const ICON_TERRAIN: Record<string, TerrainAxis> = {
  mountain: '山岳',
  trees: '林泽',
  droplets: '林泽',
  waves: '林泽',
  flame: '火域',
  sunset: '火域',
  cloud: '天象',
  zap: '天象',
  star: '天象',
  sparkles: '天象',
  castle: '废墟',
  crown: '废墟',
  sword: '废墟',
  skull: '幽冥'
}

function iconOf(regionId: string): string {
  return REGIONS.find(r => r.id === regionId)?.icon ?? 'mountain'
}

export function terrainOf(fromId: string): TerrainAxis {
  return ICON_TERRAIN[iconOf(fromId)] ?? '山岳'
}

/**
 * 世界身份四层:世界名(世界类型)/ 摘要(补世界名未表达的第一层语义)/ 路线·地界(构成)/ 规则(本世特殊条件)。
 * scattered 摘要不写地貌构成:地界列表已逐段标出地貌。
 */

/** 命名形态:按主地貌占优程度定,不按众数(3/6 与 5/6 不该拿到同样强度的语义) */
export type NamingForm =
  /** 单一地貌主导:「X 之世」 */
  | 'single'
  /** 两轴并立:「X 与 Y 交错之世」 */
  | 'dual'
  /** 高度分散:不用地貌命名,退回主题 + 生态 */
  | 'scattered'

export interface WorldIdentity {
  /** 主地貌(出现最多的一轴) */
  terrain: TerrainAxis
  /** 次地貌;dual 形态下参与命名 */
  secondary: TerrainAxis | null
  /** 主地貌占比:命名置信度依据 */
  dominance: number
  form: NamingForm
  /** 规则主题(取自世界规则的语义轴) */
  theme: MutatorTheme
  /** 主题意象 */
  themeName: string
  /** 世界名 */
  name: string
  summary: string
  /** 参与构成的语义轴数 */
  axisCount: number
}

/** 单一地貌命名所需的最低占比 */
export const DOMINANCE_SINGLE = 0.6
/** 两轴并立所需的「前二合计」最低占比 */
export const DOMINANCE_DUAL = 0.66

/** 世界级语义摘要:素材全取自区域 icon、变数主题、资源偏向,不新写剧情 */
export function worldIdentity(w: MortalWorld): WorldIdentity {
  const counts = new Map<TerrainAxis, number>()
  for (const p of w.chain) {
    const t = terrainOf(p.fromId)
    counts.set(t, (counts.get(t) ?? 0) + 1)
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1])
  const total = Math.max(1, w.chain.length)
  const terrain = sorted[0]![0]
  const dominance = sorted[0]![1] / total
  const second = sorted[1] ?? null
  const dualShare = (sorted[0]![1] + (second?.[1] ?? 0)) / total
  const theme = MUTATOR_THEMES[w.ruleId] ?? 'survival'
  const themeName = THEME_IDENTITY[theme]

  let form: NamingForm
  let name: string
  let summary: string
  let secondary: TerrainAxis | null = null
  if (dominance >= DOMINANCE_SINGLE) {
    form = 'single'
    name = `${themeName}的${terrain}之世`
    summary = `${w.bias}之地`
  } else if (second && dualShare >= DOMINANCE_DUAL) {
    form = 'dual'
    secondary = second[0]
    name = `${terrain}与${secondary}交错之世`
    summary = `${w.bias}之地,为${themeName}所笼罩`
  } else {
    form = 'scattered'
    name = `${themeName}的杂涌之世`
    summary = `${w.bias}之地,山川无序`
  }

  return {
    terrain,
    secondary,
    dominance,
    form,
    theme,
    themeName,
    name,
    summary,
    // 地貌轴数 + 规则轴 1
    axisCount: counts.size + 1
  }
}

/** 语义是否聚焦(≤2 轴,承袭天界的世界语义门) */
export function isFocused(id: WorldIdentity, maxAxes = 3): boolean {
  return id.axisCount <= maxAxes
}

// ============ 二、玩家可见特征向量 ============

/** 玩家可见特征;与结构向量(规则、敌人机制、可行流派)刻意分开 */
export interface VisibleFeatures {
  /** 地貌序列 */
  terrains: TerrainAxis[]
  /** 首尾地界类型 */
  head: TerrainAxis
  tail: TerrainAxis
  /** 出现的地界名 */
  placeNames: string[]
  /** 首领名 */
  bossNames: string[]
  /** 事件密度结构:每处地界的标签数 */
  eventDensity: number[]
  /** 路线形状:层级递进曲线 */
  shape: number[]
  bias: string
  ruleName: string
}

export function visibleFeatures(w: MortalWorld): VisibleFeatures {
  const terrains = w.chain.map(p => terrainOf(p.fromId))
  return {
    terrains,
    head: terrains[0]!,
    tail: terrains[terrains.length - 1]!,
    placeNames: w.chain.map(p => p.name),
    bossNames: w.chain.map(p => enemyDef(p.boss)?.name ?? p.boss),
    eventDensity: w.chain.map(p => p.eventTags.length),
    shape: w.chain.map(p => p.tier),
    bias: w.bias,
    ruleName: w.ruleName
  }
}

function jaccard(a: string[], b: string[]): number {
  const sa = new Set(a)
  const sb = new Set(b)
  if (sa.size === 0 && sb.size === 0) return 0
  let inter = 0
  for (const x of sa) if (sb.has(x)) inter += 1
  return 1 - inter / (sa.size + sb.size - inter)
}

function seqDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) return 1
  let diff = 0
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) diff += 1
  return diff / a.length
}

/** 玩家可见距离(0~1);权重偏向第一屏可见的地貌构成与地界名 */
export function visibleDistance(a: MortalWorld, b: MortalWorld): number {
  const va = visibleFeatures(a)
  const vb = visibleFeatures(b)
  return (
    0.25 * jaccard(va.terrains, vb.terrains) +
    0.25 * jaccard(va.placeNames, vb.placeNames) +
    0.15 * jaccard(va.bossNames, vb.bossNames) +
    0.1 * (va.head === vb.head && va.tail === vb.tail ? 0 : 1) +
    0.1 * seqDistance(va.eventDensity, vb.eventDensity) +
    0.1 * seqDistance(va.shape, vb.shape) +
    0.05 * (va.bias === vb.bias ? 0 : 1)
  )
}

/** 分维度的可见距离:聚合值里地界名 jaccard 天然偏高,会掩盖路线节奏雷同 */
export function visibleDistanceByDim(a: MortalWorld, b: MortalWorld): Record<string, number> {
  const va = visibleFeatures(a)
  const vb = visibleFeatures(b)
  return {
    地貌构成: jaccard(va.terrains, vb.terrains),
    地界名: jaccard(va.placeNames, vb.placeNames),
    首领名: jaccard(va.bossNames, vb.bossNames),
    首尾同型: va.head === vb.head && va.tail === vb.tail ? 0 : 1,
    事件密度: seqDistance(va.eventDensity, vb.eventDensity),
    路线形状: seqDistance(va.shape, vb.shape),
    资源偏向: va.bias === vb.bias ? 0 : 1
  }
}

/** 一组世界在各可见维度上的平均距离 */
export function avgVisibleByDim(worlds: MortalWorld[]): Record<string, number> {
  const acc: Record<string, number> = {}
  let n = 0
  for (let i = 0; i < worlds.length; i += 1) {
    for (let j = i + 1; j < worlds.length; j += 1) {
      const d = visibleDistanceByDim(worlds[i]!, worlds[j]!)
      for (const [k, v] of Object.entries(d)) acc[k] = (acc[k] ?? 0) + v
      n += 1
    }
  }
  for (const k of Object.keys(acc)) acc[k] = acc[k]! / Math.max(1, n)
  return acc
}

/** 可见新颖度 = 与历史最近邻的可见距离 */
export function visibleNovelty(w: MortalWorld, history: MortalWorld[]): number {
  if (history.length === 0) return 1
  return Math.min(...history.map(h => visibleDistance(w, h)))
}

export interface NoveltyGap {
  structural: number
  visible: number
  /** 结构 - 可见;为正 = 内部变了、玩家看不出 */
  gap: number
}

/** 结构新颖度与可见新颖度的落差 */
export function noveltyGap(w: MortalWorld, history: MortalWorld[]): NoveltyGap {
  const structural = mortalNovelty(w, history)
  const visible = visibleNovelty(w, history)
  return { structural, visible, gap: structural - visible }
}

// ============ 三、体验骨架去重 ============

/** 玩家可见骨架(比结构指纹粗) */
export function skeletonOf(w: MortalWorld): string {
  const v = visibleFeatures(w)
  const id = worldIdentity(w)
  return [id.terrain, id.theme, v.head, v.tail, v.eventDensity.join(''), v.shape.join('-'), v.bias].join('|')
}

export interface SkeletonRepeat {
  /** 骨架种类数 */
  distinct: number
  /** 最长连续重复次数 */
  longestRun: number
  /** 是否存在连续重复 */
  hasConsecutive: boolean
}

export function skeletonRepeats(worlds: MortalWorld[]): SkeletonRepeat {
  const keys = worlds.map(skeletonOf)
  let longest = 1
  let run = 1
  for (let i = 1; i < keys.length; i += 1) {
    run = keys[i] === keys[i - 1] ? run + 1 : 1
    longest = Math.max(longest, run)
  }
  return { distinct: new Set(keys).size, longestRun: longest, hasConsecutive: longest > 1 }
}

/** 骨架各维的实际取值数,用于找出死维 */
export function skeletonDimensions(worlds: MortalWorld[]): { dim: string; values: number; sample: string }[] {
  const dims: { dim: string; get: (w: MortalWorld) => string }[] = [
    { dim: '主地貌', get: w => worldIdentity(w).terrain },
    { dim: '规则主题', get: w => worldIdentity(w).theme },
    { dim: '首地界类型', get: w => visibleFeatures(w).head },
    { dim: '尾地界类型', get: w => visibleFeatures(w).tail },
    { dim: '事件密度结构', get: w => visibleFeatures(w).eventDensity.join('') },
    { dim: '路线形状', get: w => visibleFeatures(w).shape.join('-') },
    { dim: '资源偏向', get: w => w.bias }
  ]
  return dims.map(d => {
    const vals = worlds.map(d.get)
    return { dim: d.dim, values: new Set(vals).size, sample: [...new Set(vals)].slice(0, 3).join(' / ') }
  })
}

// ============ 四、骨架新颖度(独立指标,不与结构分平均) ============

/** 体验形状距离:段数、层级跨度、事件疏密、地貌排列;与结构分平均会让恒为 0 的维度被高分维度吃掉 */
export function skeletonDistance(a: MortalWorld, b: MortalWorld): number {
  const va = visibleFeatures(a)
  const vb = visibleFeatures(b)
  const ia = worldIdentity(a)
  const ib = worldIdentity(b)
  return (
    0.2 * (va.shape.length === vb.shape.length ? 0 : 1) +
    0.25 * shapeCurveDistance(va.shape, vb.shape) +
    0.25 * shapeCurveDistance(va.eventDensity, vb.eventDensity) +
    0.15 * seqDistance(
      va.terrains.map(t => TERRAIN_INDEX[t]),
      vb.terrains.map(t => TERRAIN_INDEX[t])
    ) +
    0.1 * (va.head === vb.head && va.tail === vb.tail ? 0 : 1) +
    0.05 * (ia.theme === ib.theme ? 0 : 1)
  )
}

const TERRAIN_INDEX: Record<TerrainAxis, number> = {
  山岳: 0,
  林泽: 1,
  火域: 2,
  天象: 3,
  废墟: 4,
  幽冥: 5
}

/** 曲线距离:长度可不同,按归一化位置比形状,不比绝对值 */
function shapeCurveDistance(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) return 1
  const n = Math.max(a.length, b.length)
  const at = (arr: number[], i: number): number => arr[Math.round((i * (arr.length - 1)) / Math.max(1, n - 1))]!
  const range = (arr: number[]): number => Math.max(1, Math.max(...arr) - Math.min(...arr))
  const ra = range(a)
  const rb = range(b)
  let sum = 0
  for (let i = 0; i < n; i += 1) {
    const na = (at(a, i) - Math.min(...a)) / ra
    const nb = (at(b, i) - Math.min(...b)) / rb
    sum += Math.abs(na - nb)
  }
  return Math.min(1, sum / n / 0.5)
}

/** 骨架新颖度 = 与历史最近邻的体验形状距离 */
export function skeletonNovelty(w: MortalWorld, history: MortalWorld[]): number {
  if (history.length === 0) return 1
  return Math.min(...history.map(h => skeletonDistance(w, h)))
}

/** 事件节奏新颖度:单独取值(骨架距离里只占 0.25,会被稀释) */
export function rhythmNovelty(w: MortalWorld, history: MortalWorld[]): number {
  if (history.length === 0) return 1
  const va = visibleFeatures(w)
  return Math.min(...history.map(h => shapeCurveDistance(va.eventDensity, visibleFeatures(h).eventDensity)))
}

