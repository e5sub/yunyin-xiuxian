/** 炼器提示:强化、分解、祭炼。只报结果与差额,数字与材料不省;缺料写「不足 / 尚差 N」,与重铸同一说法 */
export function upgradeCapToast(): string {
  return '强化已至上限'
}

/** 强化缺料:缺哪一样就说哪一样,不用一句「或」 */
export function upgradeShortToast(short: 'stone' | 'dust' | 'exp', gap?: { stone: string; dust: number; exp: string }): string {
  if (short === 'stone') return `灵石${gap?.stone ? `尚差 ${gap.stone}` : '不足'}`
  if (short === 'exp') return `修为${gap?.exp ? `尚差 ${gap.exp}` : '不足'}`
  return `器灵尘${gap?.dust ? `尚差 ${gap.dust}` : '不足'}`
}

/** 强化失手:掉了级 */
export function upgradeFailToast(name: string, level: number, dropped: number): string {
  return `「${name}」强化失手,回落 ${dropped} 级至 +${level}`
}

/** 强化失手但踩在保级点上:不掉级 */
export function upgradeSafeToast(name: string, level: number): string {
  return `「${name}」强化失手,保级于 +${level}`
}

/** 连升中途失手 */
export function upgradeBatchBrokenToast(name: string, tries: number, up: number, level: number): string {
  return `「${name}」第 ${tries} 次失手 · 成 ${up} 级 · 现 +${level}`
}

export function upgradeDoneToast(name: string, level: number): string {
  return `「${name}」已至 +${level}`
}

/** 连升总况,只报一次;stoneText 由调用方 formatGN */
export function upgradeBatchDoneToast(levels: number, newLevel: number, dust: number, stoneText: string): string {
  return `连升 ${levels} 级至 +${newLevel} · 共耗器灵尘×${dust} · 灵石 ${stoneText}`
}

export function salvageYieldText(dust: number, stoneText?: string): string {
  return stoneText ? `器灵尘×${dust} · 灵石退还 ${stoneText}` : `器灵尘×${dust}`
}

export function decomposeToast(dust: number, stoneText?: string, refund?: string): string {
  const yieldText = salvageYieldText(dust, stoneText)
  const base = `已化尘 · 得${yieldText}`
  return stoneText && refund ? `${base}(${refund})` : base
}

export function batchDecomposeToast(count: number, yieldText: string): string {
  return `已化尘 ${count} 件 · 得${yieldText}`
}

export function artifactCapToast(): string {
  return '祭炼已至上限'
}

/** 祭炼缺料:悟道点与灵石分开报 */
export function artifactShortToast(
  short: 'wudao' | 'stone',
  gap?: { wudao: number; stone: string }
): string {
  const amount = short === 'wudao' ? gap?.wudao : gap?.stone
  const missing = amount === undefined ? '不足' : `尚差 ${amount}`
  return short === 'wudao' ? `悟道点${missing}` : `灵石${missing}`
}

export function artifactDoneToast(name: string): string {
  return `「${name}」祭炼进一重`
}

/** 连炼总况,只报一次;stoneText 由调用方 formatGN */
export function artifactBatchDoneToast(levels: number, newLevel: number, wudao: number, stoneText: string): string {
  return `连炼 ${levels} 重至第 ${newLevel} 重 · 共耗悟道×${wudao} · 灵石 ${stoneText}`
}

/** 连炼中途停手:只报已炼成的重数与实耗 */
export function artifactBatchInterruptedToast(
  levels: number,
  newLevel: number,
  wudao: number,
  stoneText: string
): string {
  return `连炼 ${levels} 重即止 · 至第 ${newLevel} 重 · 实耗悟道×${wudao} · 灵石 ${stoneText}`
}
