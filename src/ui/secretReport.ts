/**
 * 秘境本层战报的播放时间线(1.79.17)。
 *
 * 逐回合战斗过程与层赏结算摘要合成一条单行序列,交给秘境卡按序揭示;
 * 播完才放开「再入一层」。纯函数:不持状态、不碰 store,便于单测钉住顺序。
 */
import type { CombatLogEntry } from '@/types'
import { COMBAT_LOG_TONE } from './combatLogText'

export interface SecretReportRow {
  /** 同层内稳定键:战斗行取日志下标,摘要行顺延 */
  id: number
  text: string
  tone: string
  /** 该行打完后的敌我血量百分比(仅战斗行有;摘要行沿用上一条战斗行) */
  php?: number
  ehp?: number
}

/**
 * 战斗过程在前、结算摘要在后 —— 先看到怎么打的,再看到得没得。
 * 伤害数字拼在同一行(与主战场 CombatPanel 的逐行战报同一读法),不另起一行
 * 把回合节奏打散。
 */
export function secretReportRows(
  log: readonly CombatLogEntry[],
  lines: readonly string[],
  win: boolean
): SecretReportRow[] {
  const rows: SecretReportRow[] = log.map((e, i) => ({
    id: i,
    text: e.dmg === undefined || e.dmg === '' ? e.text : `${e.text} ${e.dmg}`,
    tone: COMBAT_LOG_TONE[e.t],
    php: e.php,
    ehp: e.ehp
  }))
  const tone = win ? 'text-gold-ink' : 'text-cinnabar'
  for (let i = 0; i < lines.length; i++) {
    rows.push({ id: log.length + i, text: lines[i]!, tone })
  }
  return rows
}
