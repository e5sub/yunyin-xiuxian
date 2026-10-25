/**
 * 敌人认知呈现:认知层只发情报,不发属性。只做映射与文案,不改状态。
 * 「熟知修仙界」一阶(见 data/samsara.ts)门槛下调一档。
 */
import { ELEMENTS } from '@/data/linggen'
import { enemyDef } from '@/data/enemies'
import { ENEMY_LORE_MAX, ENEMY_LORE_STAGE_NAMES, useLoreStore } from '@/stores/lore'
import { ENEMY_LORE_BOSS_MULT, ENEMY_LORE_THRESHOLDS } from '@/core/loreService'
import { currentStage } from '@/core/samsaraService'
import type { BossArchetype, EnemyDef, EnemySkill } from '@/types'
import { ARCHETYPES } from '@/core/bossArchetypes'
import {
  SKILL_BLEED_ATK,
  SKILL_DRAIN_HP,
  SKILL_MULTI_HITS,
  SKILL_MULTI_RATIO,
  SKILL_SHIELD_HP,
  SKILL_STUN_CHANCE
} from '@/data/constants'
import { formatPercent } from '@/utils/format'

/** 首领本相 —— 一句话点破它的打法核心 */
const ARCHETYPE_NOTES: Record<BossArchetype, string> = {
  berserk: '越战越狂——拖得越久它越凶',
  counter: '你多段出手,它便回敬',
  truedmg: '有一记绕过一切护体的杀招',
  antiheal: '压治疗——你回的血在它面前不值钱',
  spellbane: '吞法——你法门越多,它反倒越硬',
  evasive: '身形飘忽,不容易打实',
  attrition: '自愈不止,久战反而是它的场',
  threshold: '开战即有罡盾,破不开便伤不着它'
}

export interface EnemySkillNote {
  name: string
  /** 该招的门道(无特殊效果时为倍率评语) */
  note: string
}

export interface EnemyPhaseNote {
  /** 触发时机 */
  at: string
  label: string
}

/** 战前情报:每项由认知层决定给不给 */
export interface EnemyLoreView {
  /** 有效认知层(已计入轮回阶的门槛下调) */
  stage: number
  /** 交手挣来的认知层 */
  raw: number
  /** 是否吃到「熟知修仙界」下调 */
  boosted: boolean
  stageName: string
  /** 体格评语(层 ≥1) */
  frame: string[]
  /** 本命属性(层 ≥1;无属性的敌人为 null) */
  elementName: string | null
  /** 惯用招式(层 ≥2) */
  skills: EnemySkillNote[]
  /** 残血变阵(层 = 3) */
  phases: EnemyPhaseNote[]
  /** 首领本相(层 = 3;非首领为 null) */
  archetype: string | null
  /** 首领机制家族名与印,与本相同层揭示 */
  archetypeLabel: string | null
  /** 距下一层的实账(已洞悉为 null) */
  progress: EnemyLoreProgress | null
}

/** 距下一认知层的实账,与 noteEnemy 读同一张门槛表 */
export interface EnemyLoreProgress {
  /** 已攒的有效交手次数(胜一记、败以重计,见 ENEMY_LORE_LOSS_WEIGHT) */
  seen: number
  /** 下一层所需的有效交手总数(首领加倍,见 ENEMY_LORE_BOSS_MULT) */
  need: number
  /** 还差几记有效交手(≤0 不该出现:noteEnemy 达门槛即升层) */
  remain: number
  /** 下一未见层的名字;宿慧照见已摊开最高层时为空 */
  nextName: string
  /** 首领门槛加倍过(说明里「首领倍算」的凭据) */
  isBoss: boolean
}

export function enemyLoreProgress(raw: number, seen: number, isBoss: boolean, eff: number): EnemyLoreProgress | null {
  if (raw < 0 || raw >= ENEMY_LORE_MAX) return null
  const need = ENEMY_LORE_THRESHOLDS[raw + 1]! * (isBoss ? ENEMY_LORE_BOSS_MULT : 1)
  // 下一层取 eff+1 而非 raw+1:宿慧照见抬过一档时 raw+1 已摊开
  const next = eff + 1
  const nextName = next <= ENEMY_LORE_MAX ? (ENEMY_LORE_STAGE_NAMES[next] ?? '') : ''
  return { seen, need, remain: Math.max(0, need - seen), nextName, isBoss }
}

/** 体格评语,由倍率反推 */
function frameOf(def: EnemyDef): string[] {
  const out: string[] = []
  if (def.hpMult >= 1.5) out.push('气血绵长')
  else if (def.hpMult <= 0.9) out.push('身子单薄')
  if (def.atkMult >= 1.4) out.push('出手极重')
  else if (def.atkMult <= 0.95) out.push('力道平平')
  if (def.defMult >= 1.4) out.push('皮坚甲厚')
  else if (def.defMult <= 0.85) out.push('皮肉松软')
  if (def.speed >= 1.2) out.push('身法迅捷')
  else if (def.speed <= 0.85) out.push('行动迟缓')
  return out
}

function skillNote(sk: EnemySkill): string {
  const odds = `出手 ${formatPercent(sk.rate)},威力 ${formatPercent(sk.mult)}`
  if (sk.effect === 'stun') return `${odds}。命中后再以 ${formatPercent(SKILL_STUN_CHANCE)} 摄住心神`
  if (sk.effect === 'bleed') return `${odds}。事后再伤 ${formatPercent(SKILL_BLEED_ATK)} 攻击`
  if (sk.effect === 'drain') return `${odds}。回补 ${formatPercent(SKILL_DRAIN_HP)} 气血`
  if (sk.effect === 'shield') return `${odds}。凝 ${formatPercent(SKILL_SHIELD_HP)} 气血为盾`
  if (sk.effect === 'multi') {
    return `${odds}。本击之后另起 ${SKILL_MULTI_HITS} 段,各按威力 ${formatPercent(SKILL_MULTI_RATIO)}`
  }
  if (sk.effect === 'pierce') return `${odds}。真伤贯体,护盾挡不住`
  if (sk.mult >= 2.2) return `${odds}。一记重手`
  if (sk.mult >= 1.6) return `${odds}。发力凶狠`
  return `${odds}。寻常一击`
}

/** 残血变阵,层 3 才见;单列,不并入招式表 */
function phaseNotes(def: EnemyDef): EnemyPhaseNote[] {
  return (def.phases ?? []).map(p => ({
    at: `血余 ${Math.round(p.hpThreshold * 100)}%`,
    label: p.label ?? '变阵'
  }))
}

/**
 * 按认知层揭示一头敌人,纯函数。
 * @param stage 有效认知层(调用方须先经 effectiveEnemyStage 算好轮回阶加成)
 */
export function describeEnemy(def: EnemyDef, stage: number, boosted = false): EnemyLoreView {
  const lv = Math.max(0, Math.min(ENEMY_LORE_MAX, Math.floor(stage)))
  const seen1 = lv >= 1
  const seen2 = lv >= 2
  const seen3 = lv >= ENEMY_LORE_MAX
  return {
    stage: lv,
    raw: lv,
    boosted,
    stageName: ENEMY_LORE_STAGE_NAMES[lv] ?? ENEMY_LORE_STAGE_NAMES[0],
    frame: seen1 ? frameOf(def) : [],
    elementName: seen1 && def.element ? ELEMENTS[def.element].name : null,
    skills: seen2 ? def.skills.map(sk => ({ name: sk.name, note: skillNote(sk) })) : [],
    phases: seen3 ? phaseNotes(def) : [],
    archetype: seen3 && def.archetype ? ARCHETYPE_NOTES[def.archetype] : null,
    archetypeLabel:
      seen3 && def.archetype && ARCHETYPES[def.archetype]
        ? `${ARCHETYPES[def.archetype].name} · ${ARCHETYPES[def.archetype].seal}`
        : null,
    progress: null
  }
}

/** 有效认知层 = 交手挣来的层 + 轮回阶下调;只补一档,从未交手不补 */
export function effectiveEnemyStage(raw: number, insightful: boolean): number {
  if (!insightful || raw <= 0) return raw
  return Math.min(ENEMY_LORE_MAX, raw + 1)
}

/** 读 store,给出该敌人此刻可见的情报(未知 id 返回 null) */
export function enemyLoreView(enemyId: string): EnemyLoreView | null {
  const def = enemyDef(enemyId)
  if (!def) return null
  const raw = useLoreStore().enemyLoreOf(enemyId)
  const seen = useLoreStore().enemySeenOf(enemyId)
  const insightful = currentStage().enemyInsight
  const eff = effectiveEnemyStage(raw, insightful)
  const view = describeEnemy(def, eff, eff > raw)
  return { ...view, raw, progress: enemyLoreProgress(raw, seen, def.isBoss === true, eff) }
}
