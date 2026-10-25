/**
 * 冒烟死按钮分类的纯决策,不依赖 Playwright。
 * 单一来源:scripts/ui-smoke.mjs 与单测共用这一份。
 */
/** 幂等选中项:点当前已选中的值本就无变化,不判失败 */
export const SMOKE_ALLOWLIST: readonly string[] = [
  '/settings 点「×1」', // 战报速度默认 ×1
  '/settings 点「跟随系统」', // 主题默认跟随系统
  '/inventory 弹窗内点「不设」' // 智能收纳的阶级线默认「不设」
]

export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 干净重试按名定位按钮的正则;容忍 CJK 字间空格(如「战 力▸拆解」) */
export function namePattern(label: string): RegExp {
  return new RegExp('^' + escapeRe(label).replace(/\s+/g, '\\s+') + '$')
}

export type SmokeDecision = { bucket: 'dead' | 'silent'; line: string }

/**
 * cleanResult 来自 ui-smoke 的干净重试:
 *   true   单独点有变化 → 功能正常(读数)
 *   false  单独点也无变化 → 真死控件(判失败)
 *   null   干净态找不到该按钮 → 无法复现(读数)
 * 白名单优先,恒为读数。
 */
export function classifySmoke(
  route: string,
  kind: 'page' | 'modal',
  label: string,
  cleanResult: boolean | null,
  allowlist: readonly string[] = SMOKE_ALLOWLIST
): SmokeDecision {
  const verb = kind === 'modal' ? '弹窗内点' : '点'
  const entry = `${route} ${verb}「${label}」`
  if (allowlist.includes(entry)) return { bucket: 'silent', line: `${entry}(幂等选中项,不判失败)` }
  if (cleanResult === true) {
    return { bucket: 'silent', line: `${route} 干净重试有变化(功能正常,抑制误报):${verb}「${label}」` }
  }
  if (cleanResult === null) return { bucket: 'silent', line: `${entry}(干净态无法单独复现,不判失败)` }
  return { bucket: 'dead', line: entry }
}
