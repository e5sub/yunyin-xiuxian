/** 功法参悟提示:残卷、精进。残页、悟道点、层数报清 */
export function gongfaPageShortToast(pageShort?: number): string {
  return pageShort === undefined ? '残页不足' : `残页尚差 ${pageShort} 页`
}

export function gongfaAllLearnedToast(): string {
  return '此境已收全'
}

export function gongfaComprehendToast(name: string): string {
  return `习得《${name}》`
}

export interface GongfaUpShortGap {
  wudao?: number
  page?: number
}

export function gongfaUpShortToast(short: 'wudao' | 'page' | 'both', gap?: GongfaUpShortGap): string {
  const wudao = gap?.wudao === undefined ? '悟道点不足' : `悟道点尚差 ${gap.wudao}`
  const page = gap?.page === undefined ? '残页不足' : `残页尚差 ${gap.page} 页`
  if (short === 'both') return `${wudao} · ${page}`
  return short === 'wudao' ? wudao : page
}

export function gongfaUpDoneToast(name: string, level: number): string {
  return `《${name}》已至第 ${level} 层`
}

export function gongfaSubFullToast(slots: number, kind = '辅修'): string {
  return `${kind}已满 ${slots} 席`
}
