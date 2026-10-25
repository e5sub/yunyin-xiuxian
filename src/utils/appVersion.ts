/** 应用版本的唯一来源 + 无依赖的 semver 式比较器 */
import pkg from '../../package.json'

/** 应用当前版本;同源:package.json */
export const APP_VERSION: string = pkg.version

/**
 * 比较两个 "x.y.z" 版本串。缺段按 0('1.37' 即 '1.37.0');非数字段按 0,不抛错。
 * @returns <0 表示 a 旧于 b;0 表示相等;>0 表示 a 新于 b。
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseParts(a)
  const pb = parseParts(b)
  const n = Math.max(pa.length, pb.length)
  for (let i = 0; i < n; i += 1) {
    const va = pa[i] ?? 0
    const vb = pb[i] ?? 0
    if (va !== vb) return va < vb ? -1 : 1
  }
  return 0
}

function parseParts(v: string): number[] {
  return String(v)
    .split('.')
    .map(seg => {
      const n = Number.parseInt(seg, 10)
      return Number.isFinite(n) ? n : 0
    })
}
