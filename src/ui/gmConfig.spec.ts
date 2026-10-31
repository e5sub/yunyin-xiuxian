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

/**
 * 「开关开了却没生效」比「保存失败」更坑:保存失败至少报错,开了没反应只能靠猜。
 * 人机验证就是这种——真开关是「turnstile_enabled + 两把密钥」三样齐,后台却只摆了一个开关。
 * 这几条钉住:判定别被放宽成「只认开关」(那就等于谁都能绕过)、后台必须把「开了但没生效」说明白、
 * 登录页不许把挂件加载失败吞掉。
 */
describe('人机验证 · 开关 ≠ 生效', () => {
  const TURNSTILE = readFileSync(resolve(ROOT, 'server/src/turnstile.ts'), 'utf-8')
  const LOGIN = readFileSync(resolve(ROOT, 'src/views/LoginView.vue'), 'utf-8')

  it('服务端仍是三样齐才启用(不许把开关当唯一判据)', () => {
    expect(TURNSTILE, '只认开关就等于开了也没人拦:密钥缺失时必须仍算未启用').toMatch(
      /enabled:\s*on\s*&&\s*site !== ''\s*&&\s*key !== ''/
    )
  })

  it('后台给人机验证配了联合判定提示,且随三个字段更新', () => {
    expect(GM_PAGE, '缺提示位:管理员只看到开关,以为开了就生效').toContain('id="cfg-ts-hint"')
    const fn = /function updateTsHint \(\)[\s\S]*?\n}/.exec(GM_PAGE)
    expect(fn, '找不到 updateTsHint —— 改名了?这份判据要跟着改').not.toBeNull()
    const body = fn![0]
    for (const key of ['turnstile_enabled', 'turnstile_site_key', 'turnstile_secret_key']) {
      expect(body, `提示没看 ${key}`).toContain(key)
    }
    expect(body, '开了但密钥不全时要说清「不会生效」').toContain('不会生效')
    // 三处触发:页面渲染完、掰开关、改密钥
    expect(GM_PAGE.match(/updateTsHint\(\)/g)?.length ?? 0, '只在渲染时算一次的话,掰开关看不到变化').toBeGreaterThanOrEqual(3)
  })

  it('登录页不吞挂件加载失败:有可见文案和重试入口', () => {
    expect(LOGIN).toContain('tsBroken')
    expect(LOGIN, '脚本被拦/超时时要说话,不能留白').toContain('人机验证没能加载')
    expect(LOGIN, '重试入口:拦一下就永久废掉太脆').toContain('retryTurnstile')
  })

  it('CSP 拦截要单独说出来(否则会让人去查根本不存在的网络问题)', () => {
    const util = readFileSync(resolve(ROOT, 'src/utils/turnstile.ts'), 'utf-8')
    expect(util, 'CSP 拦脚本时元素上也只有笼统的 error,得靠 securitypolicyviolation 才分得清').toContain(
      'securitypolicyviolation'
    )
    expect(util).toContain("'csp'")
    expect(LOGIN, '界面要把「安全策略拦下」与「没能加载」分开说').toContain('人机验证被站点安全策略拦下')
    expect(LOGIN, '控制台留一份能照抄的修法').toContain('challenges.cloudflare.com')
  })
})
