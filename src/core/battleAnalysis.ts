/** 战斗分析:从战斗遥测推导「为什么输 / 表现如何」;报原因与方向,不替玩家做决定 */
import type { CombatResult, CombatSideStats, FoeOrigin, GNum } from '@/types'
import { ratio } from '@/utils/gnum'
import { formatGN, formatPercent } from '@/utils/format'
import { BUILD_STYLES } from './buildDetect'

export interface AnalysisFinding {
  text: string
  /** 该问题指向的流派方向(styleId 列表,按相关度排序) */
  styleHints: string[]
}

export interface BattleAnalysis {
  headline: string
  findings: AnalysisFinding[]
  /** 借力方向(排除当前主流派,至多 2 条) */
  directions: { styleName: string; reason: string }[]
  dataRows: { label: string; value: string }[]
}

const PIERCE_SHARE_WARN = 0.35
const MISS_RATE_WARN = 0.28
const BIG_HIT_WARN = 0.38
const LONG_FIGHT_ROUNDS = 30
const LOW_HEAL_SHARE = 0.12
const STUN_WARN = 3

/** 有没有账可报,含「比这一层该有的还薄」的反向账 */
function hasAccount(o: FoeOrigin): boolean {
  return o.parts.some(p => p.ratio !== 1) || o.damageBonus > 0 || o.damageReduction > 0
}

/** 敌人真占了便宜(更厚、或增伤减伤不为零)才在败因里点名 */
function hasEdge(o: FoeOrigin): boolean {
  return o.ratio > 1 || o.damageBonus > 0 || o.damageReduction > 0
}

/** 倍数用两位小数:1.9 与 1.87 对玩家是两回事 */
const ratioText = (n: number): string => `×${(Math.round(n * 100) / 100).toFixed(2)}`

/** 各项来源摊成一行:「层级补偿 ×1.90 · 地界凶险 ×1.15」 */
export function foeOriginPartsText(origin: FoeOrigin): string {
  return origin.parts
    .filter(p => p.ratio !== 1)
    .map(p => `${p.label} ${ratioText(p.ratio)}`)
    .join(' · ')
}

/** 敌人加成的账目(哪几件事、各乘了多少);空数组 = 没有额外加成(中性) */
export function foeOriginLines(origin: FoeOrigin | undefined): string[] {
  if (!origin || !hasAccount(origin)) return []
  const lines: string[] = []
  for (const p of origin.parts) {
    if (p.ratio === 1) continue
    lines.push(`${p.label} ${ratioText(p.ratio)}`)
  }
  if (origin.damageBonus > 0) lines.push(`${origin.label} 增伤 +${Math.round(origin.damageBonus * 100)}%`)
  if (origin.damageReduction > 0) lines.push(`${origin.label} 减伤 +${Math.round(origin.damageReduction * 100)}%`)
  if (origin.note) lines.push(origin.note)
  return lines.length > 0 ? lines : [`${origin.label} ${ratioText(origin.ratio)}`]
}

/** 一行读数:「三维 ×1.87(层级补偿 ×1.90 · 危地 ×0.98)」 */
export function foeOriginRow(origin: FoeOrigin): { label: string; value: string } {
  if (!hasAccount(origin)) return { label: '敌之加成', value: '无' }
  const detail = foeOriginPartsText(origin)
  const extras: string[] = []
  if (origin.damageBonus > 0) extras.push(`增伤 +${Math.round(origin.damageBonus * 100)}%`)
  if (origin.damageReduction > 0) extras.push(`减伤 +${Math.round(origin.damageReduction * 100)}%`)
  const head = `三维 ${ratioText(origin.ratio)}${detail ? `(${detail})` : ''}`
  return { label: '敌之加成', value: [head, ...extras].join(' · ') }
}

function share(part: GNum, whole: GNum): number {
  if (whole.m === 0) return 0
  return Math.max(0, Math.min(1, ratio(part, whole)))
}

/** 数据面板行(胜负皆可看) */
export function battleDataRows(result: CombatResult): { label: string; value: string }[] {
  const s = result.stats
  if (!s) return []
  const p = s.player
  const attempts = p.hitsLanded + p.missedHits
  const rows: { label: string; value: string }[] = [
    // 先手与敌之加成在前:同属战前就定下的数
    ...(result.firstMove ? [firstMoveRow(result)] : []),
    ...(result.foeOrigin ? [foeOriginRow(result.foeOrigin)] : []),
    { label: '总输出', value: formatGN(p.dealt) },
    { label: '总承伤', value: formatGN(p.taken) },
    { label: '真伤承伤占比', value: formatPercent(share(p.pierceTaken, p.taken)) },
    { label: '单次最大承伤', value: formatGN(p.biggestHitTaken) },
    { label: '治疗量', value: formatGN(p.healed) },
    { label: '护盾吸收', value: formatGN(p.shieldAbsorbed) },
    { label: '命中 / 落空', value: `${p.hitsLanded} / ${p.missedHits}` },
    { label: '暴击 / 连击 / 反击', value: `${p.crits} / ${p.combos} / ${p.counters}` },
    { label: '神通 / 法宝触发', value: `${p.skillCasts} / ${p.artifactProcs}` }
  ]
  if (attempts === 0) return rows.slice(0, 6)
  return rows
}

/** 先手判定的读数与差额:差额用显示出来的那两个数算(先各留两位再相减),不带浮点误差 */
function firstMoveReadout(result: CombatResult): { playerSpeed: number; enemySpeed: number; gapPct: number; text: string } {
  const f = result.firstMove!
  const playerSpeed = Math.round(f.playerSpeed * 100) / 100
  const enemySpeed = Math.round(f.enemySpeed * 100) / 100
  const gapPct = Math.max(0, Math.round((enemySpeed - playerSpeed) * 100))
  return {
    playerSpeed,
    enemySpeed,
    gapPct,
    text: f.playerFirst
      ? `抢先 · 我 ${playerSpeed.toFixed(2)} ≥ 敌 ${enemySpeed.toFixed(2)}`
      : `被抢先 · 我 ${playerSpeed.toFixed(2)} < 敌 ${enemySpeed.toFixed(2)}`
  }
}

function firstMoveRow(result: CombatResult): { label: string; value: string } {
  return { label: '先手', value: firstMoveReadout(result).text }
}

/** 被抢先时报还差几个百分点(「尚差 N%」) */
function firstMoveFinding(result: CombatResult): AnalysisFinding[] {
  const f = result.firstMove
  if (!f || f.playerFirst) return []
  const { playerSpeed, enemySpeed, gapPct: gap } = firstMoveReadout(result)
  if (gap <= 0) return []
  return [
    {
      text: `先手判定:我 ${playerSpeed.toFixed(2)} < 敌 ${enemySpeed.toFixed(2)} · 尚差 ${gap}%`,
      styleHints: ['fengmang']
    }
  ]
}

/** 败北时敌人加成的归因:只在敌人真占了便宜时出现 */
function foeOriginFinding(result: CombatResult): AnalysisFinding[] {
  const o = result.foeOrigin
  if (!o || !hasEdge(o)) return []
  const lines = foeOriginLines(o)
  if (lines.length === 0) return []
  return [{ text: `敌之加成:${lines.join(' · ')}`, styleHints: [] }]
}

function defeatFindings(p: CombatSideStats, maxHpProxy: GNum, rounds: number): AnalysisFinding[] {
  const findings: AnalysisFinding[] = []
  const pierceShare = share(p.pierceTaken, p.taken)
  if (pierceShare >= PIERCE_SHARE_WARN) {
    findings.push({
      text: `真伤占承伤 ${formatPercent(pierceShare, 0)}`,
      styleHints: ['muze', 'beishui']
    })
  }
  const attempts = p.hitsLanded + p.missedHits
  const missRate = attempts > 0 ? p.missedHits / attempts : 0
  if (missRate >= MISS_RATE_WARN) {
    findings.push({
      text: `落空率 ${formatPercent(missRate, 0)}(${p.missedHits} 次)`,
      styleHints: ['gangdun', 'muze']
    })
  }
  const bigShare = share(p.biggestHitTaken, maxHpProxy)
  if (bigShare >= BIG_HIT_WARN) {
    findings.push({
      text: `单次重击最高 ${formatPercent(bigShare, 0)} 气血`,
      styleHints: ['gangdun', 'lianji']
    })
  }
  if (rounds >= LONG_FIGHT_ROUNDS && share(p.healed, p.taken) < LOW_HEAL_SHARE) {
    findings.push({
      text: `鏖战 ${rounds} 回合 · 几无回复`,
      styleHints: ['muze', 'beishui']
    })
  }
  if (p.stunnedTurns >= STUN_WARN) {
    findings.push({
      text: `被震慑 ${p.stunnedTurns} 回合`,
      styleHints: ['gangdun']
    })
  }
  return findings
}

/** @param currentStyleId 当前主流派(用于排除自荐) */
export function analyzeBattle(result: CombatResult, currentStyleId: string | null): BattleAnalysis | null {
  const s = result.stats
  if (!s) return null
  const dataRows = battleDataRows(result)
  if (result.win) {
    return {
      headline: `胜于第 ${result.rounds} 回合`,
      findings: [],
      directions: [],
      dataRows
    }
  }
  // 用 taken 近似血量池(承伤超过血池才落败)
  const p = s.player
  // 敌之加成与先手判定同列最前(战前就定下的数),逐项伤害占比在后
  const findings = [...foeOriginFinding(result), ...firstMoveFinding(result), ...defeatFindings(p, p.taken, result.rounds)]
  const hintCount = new Map<string, number>()
  for (const f of findings) {
    f.styleHints.forEach((id, idx) => {
      if (id !== currentStyleId) hintCount.set(id, (hintCount.get(id) ?? 0) + (2 - idx))
    })
  }
  const directions = [...hintCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([id]) => {
      const style = BUILD_STYLES.find(x => x.id === id)!
      return { styleName: style.name, reason: style.desc }
    })
  return {
    headline: `败于第 ${result.rounds} 回合`,
    findings: findings.length > 0 ? findings : [{ text: '无明显短板', styleHints: [] }],
    directions,
    dataRows
  }
}
