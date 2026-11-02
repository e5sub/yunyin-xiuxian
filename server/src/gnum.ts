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

/** 中文单位:每 4 个数量级一档(与前端 src/utils/format.ts 的 UNITS 同序同长) */
const UNITS = ['万', '亿', '兆', '京', '垓', '秭', '穰', '沟', '涧', '正', '载', '极'] as const

function trimZero(s: string): string {
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s
}

function fixedByMag(v: number): string {
  if (v < 10) return v.toFixed(3)
  if (v < 100) return v.toFixed(2)
  if (v < 1000) return v.toFixed(1)
  return String(Math.floor(v))
}

/**
 * 数值文案:8,563 → 19.58亿 → 1.24e52。
 * 与前端 formatGN 同口径 —— 别再印 `1.958e9` 这种原始指数,玩家看不懂,
 * 也和副本战报、伤害飘字里别处的写法对不上。
 */
export function geText(a: GE): string {
  if (a.m === 0) return '0'
  if (a.m < 0) return '-' + geText({ m: -a.m, e: a.e })
  if (a.e < 4) {
    const n = a.m * Math.pow(10, a.e)
    if (n < 1000) {
      if (n < 100 && !Number.isInteger(n)) {
        // 正数不显示成 0:位数随数量级抬升(0.04→2 位,0.004→3 位),封顶 6 位
        const tiny = n > 0 && n < 0.1 ? n.toFixed(Math.max(2, Math.min(6, 1 - Math.floor(Math.log10(n))))) : n.toFixed(1)
        return trimZero(tiny)
      }
      return String(Math.round(n))
    }
    return Math.round(n).toLocaleString('en-US')
  }
  const unitIdx = Math.floor(a.e / 4) - 1
  if (unitIdx >= UNITS.length) {
    // 超出「极」才退科学计数;先把 9.999 进位成 10.00 的情况收掉
    const s = a.m.toFixed(2)
    return s === '10.00' ? `1.00e${a.e + 1}` : `${s}e${a.e}`
  }
  const value = a.m * Math.pow(10, a.e - (unitIdx + 1) * 4)
  return trimZero(fixedByMag(value)) + UNITS[unitIdx]
}

/** [min,max) 区间随机 */
export function randRange(min: number, max: number): number {
  return min + (randomInt(0, 1000) / 1000) * (max - min)
}

/** [min,max) 整数随机 */
export function randomIntRange(min: number, max: number): number {
  return randomInt(min, max)
}
