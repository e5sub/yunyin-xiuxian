/** 规则纪元:规则体系的版本化。道痕记录每战所处纪元,规则变更后旧道痕的「忆战」标注天道已变 */

export const RULESET_VERSION = '25.0'

/** 纪元变迁史(只记改变战斗规则本身的变更,不记内容增删) */
export const RULESET_CHANGELOG: { version: string; note: string }[] = [
  { version: '19.0', note: '超时判负 · 护盾上限 50% · 模拟预算守恒' },
  { version: '19.5', note: '同词条多来源 100/75/50/25 递减' },
  { version: '20.0', note: '规则注入层:道途 / 特殊世界' },
  { version: '21.0', note: '契约 / 变数 / 路线 / 组合技 / 长生印' },
  { version: '25.0', note: '规则宇宙审计基线固化' }
]

/** 纪元先后比较:只认点号分段数字 */
export function rulesetBefore(a: string, b: string): boolean {
  const pa = a.split('.').map(n => Number(n) || 0)
  const pb = b.split('.').map(n => Number(n) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x !== y) return x < y
  }
  return false
}

/** 此痕是否录于旧纪 */
export function isStaleRuleset(version: string | undefined): boolean {
  return version !== undefined && version !== RULESET_VERSION
}

/** 某纪元之后(不含该纪元)的规则变更,供忆战/重写前展示;无纪元(远古战录)返回空 */
export function rulesetChangesSince(version: string | undefined): { version: string; note: string }[] {
  if (!version) return []
  return RULESET_CHANGELOG.filter(c => rulesetBefore(version, c.version))
}
