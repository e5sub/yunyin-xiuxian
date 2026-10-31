/**
 * GM 后台配置页 ↔ 服务端校验的对照判据。
 *
 * 后台每个字段最终都走 `PUT /gm/config/:key`,而这条路由先过 admin.ts 的 `allowed` 白名单:
 * 漏登记不报错、不告警,只是保存时回一句「不支持的参数」—— 页面上的开关掰得动、看着像生效,
 * 其实一次都没存进去(`turnstile_enabled` 就这么栽过)。反向也会错:文本键被列进 `nKeys`
 * 就会被当数值校验,站点密钥「0x4AAA…」存进去只会报「数值参数无效」。
 *
 * 这里把三处对齐:后台页的字段表、白名单、各类型名单;另确认每个键在建库时都有种子值
 * (老库没有该行时 /config 取不到,输入框空白,人会以为设置丢了)。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(__dirname, '../..')
const ADMIN = readFileSync(resolve(ROOT, 'server/src/admin.ts'), 'utf-8')
const GM_PAGE = readFileSync(resolve(ROOT, 'server/gm/index.html'), 'utf-8')
const DB = readFileSync(resolve(ROOT, 'server/src/db.ts'), 'utf-8')

type Kind = 'bool' | 'num' | 'text' | 'long'

/** admin.ts 里某个 `const xxx = [...]` 名单的字符串项 */
function listOf(name: string): string[] {
  const m = new RegExp(`const ${name} = \\[([\\s\\S]*?)\\]`).exec(ADMIN)
  if (m === null) throw new Error(`admin.ts 里找不到 ${name} 名单 —— 改名了?这份判据要跟着改`)
  return [...m[1]!.matchAll(/'([a-z0-9_]+)'/g)].map(x => x[1]!)
}

/** 后台配置页的字段表:`键: ['标签', '类型']`,按 CFG_GROUPS 分组书写 */
function gmFields(): Array<[string, Kind]> {
  const from = GM_PAGE.indexOf('const CFG_GROUPS = [')
  const to = GM_PAGE.indexOf('const cfgOrig')
  if (from < 0 || to < 0) throw new Error('server/gm/index.html 里找不到 CFG_GROUPS / cfgOrig —— 结构变了?')
  return [...GM_PAGE.slice(from, to).matchAll(/([a-z][a-z0-9_]+): \['[^']*', '(bool|num|text|long)'\]/g)].map(m => [
    m[1]!,
    m[2]! as Kind
  ])
}

const FIELDS = gmFields()

describe('GM 后台 · 配置字段与保存校验对得上', () => {
  it('字段表不是空的(防空转)', () => {
    expect(FIELDS.length).toBeGreaterThan(30)
  })

  it('后台每个字段都在服务端白名单里', () => {
    const allowed = listOf('allowed')
    const missing = FIELDS.filter(([key]) => !allowed.includes(key)).map(([key]) => key)
    expect(missing, '这些字段后台有、服务端却回「不支持的参数」').toEqual([])
  })

  it('每个键在建库时都有种子值', () => {
    const seeds = [...DB.matchAll(/\[\s*'([a-z0-9_]+)',/g)].map(m => m[1]!)
    const missing = listOf('allowed').filter(key => !seeds.includes(key))
    expect(missing, '这些键没有种子默认值 —— 老库读到空,后台显示空白').toEqual([])
  })

  it('录入形态与服务端校验一致:开关对 bool、数字框对 nKeys、文本框不当数值', () => {
    const nKeys = listOf('nKeys')
    const boolKeys = listOf('boolKeys')
    const priceKeys = listOf('priceKeys')
    const longKeys = listOf('longTextKeys')
    const bad: string[] = []
    for (const [key, kind] of FIELDS) {
      if (kind === 'bool' && !boolKeys.includes(key)) bad.push(`${key}: 后台是开关,服务端没按 true/false 校验`)
      if (kind === 'num' && !nKeys.includes(key) && !priceKeys.includes(key)) bad.push(`${key}: 后台是数字框,服务端没按数值校验`)
      if (kind === 'long' && !longKeys.includes(key)) bad.push(`${key}: 后台是长文本框,服务端没放宽长度`)
      if (kind === 'text' && (nKeys.includes(key) || priceKeys.includes(key))) bad.push(`${key}: 后台是文本框,服务端却当数值校验`)
    }
    expect(bad).toEqual([])
  })

  it('布尔键的种子值只写 true/false', () => {
    // 种子写成 '1' / 'on' 时,服务端存的一直是 'true'/'false',首帧开关状态会读成「关」
    const boolKeys = listOf('boolKeys')
    const bad = boolKeys
      .map(key => {
        const m = new RegExp(`\\[\\s*'${key}',\\s*(?:env\\('[A-Z0-9_]+',\\s*)?'([^']*)'`).exec(DB)
        return m === null || m[1] === 'true' || m[1] === 'false' ? null : `${key} = ${m[1]}`
      })
      .filter((x): x is string => x !== null)
    expect(bad, '布尔键的种子值只能是 "true" / "false"').toEqual([])
  })
})
