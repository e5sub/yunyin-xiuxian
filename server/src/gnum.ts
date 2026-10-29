/** GNum(m×10^e)服务器侧算术:副本与妖王共用 */
import { randomInt } from 'node:crypto'

export interface GE {
  m: number
  e: number
}

export function geNorm(m: number, e: number): GE {
  if (!Number.isFinite(m) || m === 0) return { m: 0, e: 0 }
  const shift = Math.floor(Math.log10(Math.abs(m)))
  const nm = m / Math.pow(10, shift)
  if (Math.abs(nm) >= 10) return geNorm(nm / 10, e + shift + 1)
  return { m: nm, e: e + shift }
}

export function geAdd(a: GE, b: GE): GE {
  if (a.m === 0) return b
  if (b.m === 0) return a
  const hi = a.e >= b.e ? a : b
  const lo = a.e >= b.e ? b : a
  const diff = hi.e - lo.e
  if (diff > 15) return hi
  return geNorm(hi.m + lo.m / Math.pow(10, diff), hi.e)
}

/** a - b;b 大于 a 时结果视为 0(伤害扣除场景) */
export function geSub(a: GE, b: GE): GE {
  if (b.m === 0) return a
  const diff = a.e - b.e
  if (diff > 15) return a
  if (diff < -15) return { m: 0, e: 0 }
  return geNorm(a.m - b.m / Math.pow(10, diff), a.e)
}

export function geMulN(a: GE, n: number): GE {
  return geNorm(a.m * n, a.e)
}

/** 取小者;相等取 a(伤害结算按剩余血截断) */
export function geMin(a: GE, b: GE): GE {
  if (a.e !== b.e) return a.e < b.e ? a : b
  return Math.abs(a.m) <= Math.abs(b.m) ? a : b
}

export function geText(a: GE): string {
  if (a.m <= 0) return '0'
  if (a.e >= 6 || a.e <= -2) return `${a.m.toPrecision(4)}e${a.e}`
  let s = (a.m * Math.pow(10, a.e)).toPrecision(6)
  // 只剥小数尾零,不动整数末位的有效 0(160000 不能剥成 16)
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '')
  return s
}

/** [min,max) 区间随机 */
export function randRange(min: number, max: number): number {
  return min + (randomInt(0, 1000) / 1000) * (max - min)
}

/** [min,max) 整数随机 */
export function randomIntRange(min: number, max: number): number {
  return randomInt(min, max)
}
