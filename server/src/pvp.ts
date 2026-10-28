/** 切磋:服务端按双方快照做简化对决模拟 */
import { randomInt } from 'node:crypto'

export interface DuelSide {
  id: number
  name: string
  hpM: number
  hpE: number
  atkM: number
  atkE: number
  powerM: number
  powerE: number
}

/** m×10^e 有效值 */
function mag(m: number, e: number): number {
  if (m <= 0) return 0
  return m * Math.pow(10, e)
}

/** GNum 人类可读:m×10^e → 6 位有效以内 */
function fmt(m: number, e: number): string {
  if (m <= 0) return '0'
  if (e >= 6 || e <= -2) return `${m.toPrecision(4)}e${e}`
  return (m * Math.pow(10, e)).toPrecision(6).replace(/\.?0+$/, '')
}

function randRange(min: number, max: number): number {
  return min + randomInt(0, 1000) / 1000 * (max - min)
}

export function simulateDuel(a: DuelSide, b: DuelSide): {
  winner: 'me' | 'target'
  rounds: number
  log: string[]
} {
  let hpA = mag(a.hpM, a.hpE)
  let hpB = mag(b.hpM, b.hpE)
  const atkA = mag(a.atkM, a.atkE)
  const atkB = mag(b.atkM, b.atkE)
  const maxA = hpA
  const maxB = hpB
  const log: string[] = []
  let rounds = 0
  const MAX_ROUNDS = 60

  while (rounds < MAX_ROUNDS && hpA > 0 && hpB > 0) {
    rounds++
    const dmgA = atkA * randRange(0.85, 1.15)
    const dmgB = atkB * randRange(0.85, 1.15)
    hpA -= dmgB
    hpB -= dmgA
    if (rounds <= 6 || hpA <= 0 || hpB <= 0) {
      log.push(`第${rounds}回合 · ${a.name}打${fmtLog(dmgA)},${b.name}打${fmtLog(dmgB)}`)
    }
    if (rounds === 7) log.push('……')
  }

  let winner: 'me' | 'target'
  if (hpA <= 0 && hpB <= 0) {
    winner = hpA / maxA >= hpB / maxB ? 'me' : 'target'
  } else if (hpA <= 0) {
    winner = 'target'
  } else if (hpB <= 0) {
    winner = 'me'
  } else {
    winner = hpA / maxA >= hpB / maxB ? 'me' : 'target'
    log.push(`${MAX_ROUNDS}回合未分生死,以余血判定`)
  }
  const winnerName = winner === 'me' ? a.name : b.name
  const loserName = winner === 'me' ? b.name : a.name
  log.push(`${winnerName}胜 · ${loserName}余血 ${fmt(Math.max(0, winner === 'me' ? hpB : hpA), winner === 'me' ? b.hpE : a.hpE)}`)
  return { winner, rounds, log: log.slice(-40) }
}

function fmtLog(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return '0'
  const e = Math.floor(Math.log10(v))
  const m = v / Math.pow(10, e)
  return fmt(m, e)
}
