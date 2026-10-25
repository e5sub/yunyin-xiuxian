/** 重铸与封存提示:只报结果与差额;缺料写「不足 / 尚差 N」 */
export function reforgeEmptyToast(): string {
  return '无可重铸词条'
}

/** 缺料提示:缺哪样只说哪样 */
export function reforgeShortToast(
  short: 'stone' | 'dust',
  gap?: { stone: string; dust: number }
): string {
  const amount = short === 'stone' ? gap?.stone : gap?.dust
  const missing = amount === undefined ? '不足' : `尚差 ${amount}`
  return short === 'stone' ? `灵石${missing}` : `器灵尘${missing}`
}

export function reforgeDoneToast(countNote: string): string {
  return `已重铸 · 词条 ${countNote}`
}

/** 封存已满(每件须留一个可重掷位);与词条转移的 sealFull 同说法 */
export function sealMustLeaveToast(): string {
  return '不可封存'
}

export function sealShortToast(shortText?: string): string {
  return `灵石${shortText === undefined ? '不足' : `尚差 ${shortText}`}`
}

export function sealDoneToast(name: string): string {
  return `「${name}」已封存`
}

export function unsealDoneToast(name: string): string {
  return `「${name}」已解封`
}
