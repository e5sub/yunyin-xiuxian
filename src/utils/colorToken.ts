/**
 * 数据层颜色引用加透明度,供内联 :style 用(tailwind 斜杠透明度不走这里):
 *   var(--color-jade)       →  rgb(var(--color-jade-rgb) / 0.33)
 *   #A85C3F(无 token 的色)  →  rgb(168 92 63 / 0.33)
 * 其他形态原样返回。
 */
export function tint(tokenOrHex: string, alpha: number): string {
  const tokenVar = /var\(--color-([a-z0-9-]+)\)/.exec(tokenOrHex)
  if (tokenVar) return `rgb(var(--color-${tokenVar[1]!}-rgb) / ${alpha})`
  const hex = /^#([0-9a-fA-F]{6})$/.exec(tokenOrHex)
  if (hex) {
    const n = parseInt(hex[1]!, 16)
    return `rgb(${n >> 16} ${(n >> 8) & 255} ${n & 255} / ${alpha})`
  }
  return tokenOrHex
}
