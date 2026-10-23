/**
 * 轮回服务:宿慧怎么算、这一世的题怎么判。
 *
 * - 轮回次数(player.reincarnation.count):只兜底资质地板,不承担其他成长职责。
 * - 轮回阶段(data/samsara.ts):由宿慧决定,只开信息与知识,不给属性。
 * - 轮回遗产(stores/lore.ts):认知本身,跨世不清零、不折减。
 *
 * 宿慧两本账,相加为 totalInsight():
 * - 存量(player.reincarnation.insight):历世阅历 + 已达成的命题,落进存档,不能重算;
 * - 现量(loreInsight):由当下认知折算,不存档(存了会与认知对不上账)。
 */
import { LORE_MAX, MATERIALS } from '@/data/materials'
import { SKILL_IDS, skillLevelFromExp } from '@/data/crafting'
import { REINCARNATE_APTITUDE_FLOOR } from '@/data/constants'
import {
  INSIGHT_PER_APTITUDE,
  INSIGHT_PER_ENEMY,
  INSIGHT_PER_LIFE_REALM,
  INSIGHT_PER_MATERIAL,
  INSIGHT_PER_MATERIAL_MASTERED,
  INSIGHT_PER_RECIPE,
  INSIGHT_SKILL_DIV,
  stageAt,
  type LifeVow,
  type SamsaraStageDef
} from '@/data/samsara'
import { lifeThemeDef, themesForStage, type LifeTaboo, type LifeThemeDef, type LifeThemeMetric } from '@/data/lifeThemes'
import { ENEMY_LORE_MAX, useLoreStore } from '@/stores/lore'
import { usePlayerStore } from '@/stores/player'
import { useQuestsStore } from '@/stores/quests'
import { useCultivationStore } from '@/stores/cultivation'
import { useUiStore } from '@/stores/ui'
import type { CounterKey } from '@/types'

// ============ 宿慧折算(纯函数) ============

/** 折算宿慧所需的认知快照(与 store 解耦) */
export interface LoreSnapshot {
  /** 灵材 id → 认知层 0~3 */
  materialLore: Record<string, number>
  /** 丹方 id → 掌握度 0~1 */
  recipeLore: Record<string, number>
  /** 技艺 id → 累积经验 */
  skillExp: Record<string, number>
  /** 敌人 id → 认知层 0~3 */
  enemyLore: Record<string, number>
}

/** 由认知折算的宿慧(现量):灵材(认得、通晓各计一份)、通晓的丹方、技艺熟练度、洞悉的敌手 */
export function loreInsight(snap: LoreSnapshot): number {
  let sum = 0
  for (const v of Object.values(snap.materialLore)) {
    if (v >= 1) sum += INSIGHT_PER_MATERIAL
    if (v >= LORE_MAX) sum += INSIGHT_PER_MATERIAL_MASTERED
  }
  for (const v of Object.values(snap.recipeLore)) {
    if (v >= 1) sum += INSIGHT_PER_RECIPE
  }
  let skillSum = 0
  for (const id of SKILL_IDS) {
    skillSum += skillLevelFromExp(snap.skillExp[id] ?? 0)
  }
  sum += skillSum / INSIGHT_SKILL_DIV
  for (const v of Object.values(snap.enemyLore)) {
    if (v >= ENEMY_LORE_MAX) sum += INSIGHT_PER_ENEMY
  }
  return Math.floor(sum)
}

/** 一世走到某大境界,留下多少阅历 */
export function lifeInsight(major: number): number {
  return (Math.max(0, major) + 1) * INSIGHT_PER_LIFE_REALM
}

// ============ 当下取数 ============

function snapshotLore(): LoreSnapshot {
  const lore = useLoreStore()
  return {
    materialLore: lore.materialLore,
    recipeLore: lore.recipeLore,
    skillExp: lore.skillExp,
    enemyLore: lore.enemyLore
  }
}

/** 此刻的宿慧 = 存量 + 现量 */
export function totalInsight(): number {
  return usePlayerStore().reincarnation.insight + loreInsight(snapshotLore())
}

/** 此刻所处的轮回阶段 */
export function currentStage(): SamsaraStageDef {
  return stageAt(totalInsight())
}

/**
 * 转世后的灵根资质地板:「转世次数 × 5」与宿慧折算取较大者。
 * 预览转世时传结算后的宿慧与认得灵材数,只计补齐认知的增量,不落账。
 */
export function aptitudeFloorNow(insight = totalInsight(), knownMaterials?: number): number {
  const player = usePlayerStore()
  if (knownMaterials !== undefined) {
    const lore = useLoreStore()
    const knownBefore = MATERIALS.filter(m => lore.loreOf(m.id) >= 1).length
    insight += (knownMaterials - knownBefore) * INSIGHT_PER_MATERIAL
  }
  const byCount = REINCARNATE_APTITUDE_FLOOR * (player.reincarnation.count + 1)
  const byInsight = Math.floor(insight / INSIGHT_PER_APTITUDE)
  return Math.max(byCount, byInsight)
}

/**
 * 转世睁眼时把该阶认得的灵材至少提到「已辨识」(只补足,不清零)。
 * @param all 持「真仙道痕」传承时为 true:不按本世境界,最高档全带
 * @returns 本次新认出的灵材数
 */
export function carryLore(stage: SamsaraStageDef, all = false): number {
  const rank = all ? MAX_MATERIAL_RANK : stage.knownMaterialRank
  if (rank <= 0) return 0
  const lore = useLoreStore()
  let n = 0
  for (const m of MATERIALS) {
    if (m.rank <= rank && lore.advanceLore(m.id, 1)) n += 1
  }
  return n
}

/** 灵材的最高 rank(供「最高档全带」用) */
const MAX_MATERIAL_RANK = MATERIALS.reduce((max, m) => Math.max(max, m.rank), 0)

/** 转世睁眼时一共认得几味灵材(不改动状态,供轮回界面预告;all 同 carryLore) */
export function carryLorePreview(stage: SamsaraStageDef, all = false): number {
  const lore = useLoreStore()
  const rank = all ? MAX_MATERIAL_RANK : stage.knownMaterialRank
  return MATERIALS.filter(m => m.rank <= rank || lore.loreOf(m.id) >= 1).length
}

// ============ 这一世的命题 ============

/** 命题进度 */
export interface ThemeProgress {
  cur: number
  need: number
  done: boolean
}

function countersDelta(key: CounterKey, base: Partial<Record<CounterKey, number>>): number {
  return Math.max(0, useQuestsStore().counter(key) - (base[key] ?? 0))
}

/** 已择定的悟道分支数 */
export function branchCount(): number {
  return Object.keys(useCultivationStore().gongfaBranch).length
}

/** 已雪耻的宿敌数 */
export function avengedCount(): number {
  return usePlayerStore().nemeses.filter(n => n.avengedAt !== undefined).length
}

/** 单条判据的进度 */
function metricProgress(metric: LifeThemeMetric, vow: LifeVow): ThemeProgress {
  const player = usePlayerStore()
  const lore = useLoreStore()
  switch (metric.kind) {
    case 'realm':
      return prog(player.major, metric.major)
    case 'counter':
      return prog(countersDelta(metric.key, vow.base), metric.n)
    case 'materialLore': {
      const n = Object.values(lore.materialLore).filter(v => v >= metric.stage).length
      return prog(n, metric.n)
    }
    case 'recipeMastered':
      return prog(lore.masteredRecipeCount, metric.n)
    case 'skill':
      return prog(lore.skillLevel(metric.id), metric.level)
    case 'enemyLore':
      return prog(lore.masteredEnemyCount, metric.n)
    case 'branch':
      return prog(Math.max(0, branchCount() - vow.baseBranches), metric.n)
    case 'avenge':
      return prog(Math.max(0, avengedCount() - vow.baseAvenged), metric.n)
    case 'all': {
      // 取最落后的一条作为整体进度;全部达成才算达成
      const parts = metric.of.map(m => metricProgress(m, vow))
      // need<=0 视为已达成(ratio=1):0/0→NaN、cur/0→Infinity 会让 reduce 选错
      const ratioOf = (p: ThemeProgress): number => (p.need <= 0 ? 1 : p.cur / p.need)
      const worst = parts.reduce((a, b) => (ratioOf(a) <= ratioOf(b) ? a : b))
      return { ...worst, done: parts.every(p => p.done) }
    }
  }
}

function prog(cur: number, need: number): ThemeProgress {
  return { cur, need, done: cur >= need }
}

/** 本世命题的进度(未立题返回 null) */
export function vowProgress(): ThemeProgress | null {
  const vow = usePlayerStore().reincarnation.vow
  const def = vow ? lifeThemeDef(vow.themeId) : undefined
  if (!vow || !def) return null
  return metricProgress(def.metric, vow)
}

/** 本世命题的结局:已破 / 已成 / 未竟 */
export function vowResult(): 'broken' | 'done' | 'unfinished' | null {
  const vow = usePlayerStore().reincarnation.vow
  if (!vow) return null
  if (vow.broken) return 'broken'
  return vowProgress()?.done ? 'done' : 'unfinished'
}

/** 犯忌讳:服丹与祭法宝处调用,当场判定 */
export function noteTaboo(taboo: LifeTaboo): void {
  const player = usePlayerStore()
  const vow = player.reincarnation.vow
  if (!vow || vow.broken) return
  const def = lifeThemeDef(vow.themeId)
  if (def?.taboo !== taboo) return
  player.breakVow()
  useUiStore().toast('命题已破', 'warn')
}

/**
 * 该阶可选的命题:顶阶自选,其余抽三取一。
 * @param rngPick 抽签函数(注入以便测试)
 */
export function offerThemes(stage: SamsaraStageDef, rngPick: (arr: LifeThemeDef[]) => LifeThemeDef): LifeThemeDef[] {
  const pool = themesForStage(stage.index)
  if (stage.themeFreeChoice || pool.length <= 3) return pool
  const out: LifeThemeDef[] = []
  const rest = [...pool]
  for (let i = 0; i < 3 && rest.length > 0; i += 1) {
    const picked = rngPick(rest)
    out.push(picked)
    rest.splice(rest.indexOf(picked), 1)
  }
  return out
}

/** 开启新的一世:立题并给跨世累计的计数器打快照(「本世计」;手法同 stores/quests.ts 的 rolloverDaily) */
export function beginLife(themeId: string | null, now = Date.now()): void {
  const player = usePlayerStore()
  if (themeId === null || !lifeThemeDef(themeId)) {
    player.setVow(null)
    return
  }
  const quests = useQuestsStore()
  player.setVow({
    themeId,
    at: now,
    base: { ...quests.counters },
    baseBranches: branchCount(),
    baseAvenged: avengedCount(),
    broken: false
  })
}
