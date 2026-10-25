/** 丹药提示(服用与开炉):只报结果,药力与枚数照实报清 */
export function pillGoneToast(): string {
  return '囊中无此丹'
}

export function pillTakenToast(name: string, effects: string): string {
  return effects ? `服下「${name}」,${effects}` : `服下「${name}」`
}

export interface CraftShortGap {
  /** 当前品灵草还差几株;不缺时省略 */
  herb?: number
  /** 灵石还差多少(调用方已格式化);不缺时省略 */
  stone?: string
}

/** 开炉缺料回执。不传 gap 为总称兜底;拿得到差额时须传入,只报缺的那样 */
export function craftShortToast(gap?: CraftShortGap): string {
  if (!gap) return '灵草或灵石不足'
  const parts: string[] = []
  if ((gap.herb ?? 0) > 0) parts.push(`灵草尚差 ${gap.herb} 株`)
  if (gap.stone) parts.push(`灵石尚差 ${gap.stone}`)
  return parts.length > 0 ? parts.join(' · ') : '灵草或灵石不足'
}

/** 方子不存在 / 没解析出配方;与缺料分开报 */
export function craftUnknownToast(): string {
  return '不知此方'
}

export function craftOkToast(name: string, extra: boolean): string {
  return extra ? `双丹,得「${name}」两枚` : `丹成,得「${name}」一枚`
}
