/**
 * 死导出审计:每个顶层导出除声明处外,src 里还须有别人用;要么接上,要么删掉。
 * 确有理由先留的登记在 ALLOWLIST,写明原因和去处;一旦有人接上即变红,提醒销账。
 *
 * 故障注入:把 ALLOWLIST 里任一项接上(或删掉某个真导出的来源),或往 src 里加一个没人用的 `export const x = 1`,本用例红。
 *
 * 判据用 TypeScript 语法树:注释与字符串里的名字、`obj.foo` 的属性名、接口字段名都不算使用。
 */
import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const SRC = resolve(__dirname, '..')

/** 暂不接线的导出;每一项须写清为什么留、什么时候销账 */
const ALLOWLIST: Record<string, string> = {
  studyBlueprint: '炼器图纸骨架:contentReachabilityAudit 已钉"读与给必须一起接",此处不重复扣押'
}

/**
 * 审计/分析模块:导出给用例读,整份豁免 spec-only 红线。新增分析模块须在此登记。
 * 不自动识别:审计模块常有导出被界面借用,「有导出被运行时用过」「从 main 沿 import 传递可达」两种判据都会误报。
 */
const AUDIT_MODULES = new Set([
  'core/buildSearch.ts',
  'core/buildSim.ts',
  'core/celestialSim.ts',
  'core/compoundingAudit.ts',
  'core/daoFruitCurve.ts',
  'core/daoFruitRoles.ts',
  'core/deepCultivationRoi.ts',
  'core/ecosystemHealth.ts',
  'core/fingerprints.ts',
  'core/fruitOutlets.ts',
  'core/impactSurface.ts',
  'core/inflationAudit.ts',
  'core/lootSim.ts',
  'core/mortalGate.ts',
  'core/mortalIdentity.ts',
  'core/mortalWorldGen.ts',
  'core/motivationType.ts',
  'core/narrowingImpact.ts',
  'core/overviewNecessity.ts',
  'core/progressionSim.ts',
  'core/rebirthRoi.ts',
  'core/ruleBudget.ts',
  'core/samsaraAudit.ts',
  'core/shallowRebirthGains.ts',
  'core/trialMotivation.ts'
])

/** 进比较的路径统一成正斜杠(Win 上 join 产出 `\`,打不中正斜杠键);文件系统操作仍用平台 join */
const posix = (p: string): string => p.replace(/\\/g, '/')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|vue)$/.test(entry) && !entry.endsWith('.d.ts')) out.push(posix(full))
  }
  return out
}

/** .vue 只取 <script> 块 */
function scriptOf(path: string): string {
  const text = readFileSync(path, 'utf8')
  if (!path.endsWith('.vue')) return text
  return /<script[^>]*>([\s\S]*?)<\/script>/.exec(text)?.[1] ?? ''
}

function hasExportModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) && !!ts.getModifiers(node)?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)
}

/** 属性名/字段名/枚举成员不算使用 */
function isNonUseIdentifier(node: ts.Identifier, parent: ts.Node): boolean {
  return (
    // import 不算使用(未用的 import 由 eslint 兜);别名导入 `a as b` 的原名一侧(propertyName)算使用
    (ts.isImportSpecifier(parent) && parent.propertyName !== node) ||
    ts.isImportClause(parent) ||
    ts.isExportSpecifier(parent) ||
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isPropertyAssignment(parent) && parent.name === node) ||
    (ts.isPropertySignature(parent) && parent.name === node) ||
    (ts.isPropertyDeclaration(parent) && parent.name === node) ||
    (ts.isMethodDeclaration(parent) && parent.name === node) ||
    (ts.isMethodSignature(parent) && parent.name === node) ||
    (ts.isEnumMember(parent) && parent.name === node)
  )
}

interface DeadExport {
  name: string
  file: string
}

/** 全量扫描:顶层导出名 → 出现次数(声明处各计一次;spec 与运行时分开计) */
function scanExports(): { dead: DeadExport[]; specOnly: DeadExport[]; scanned: number; exports: number } {
  const files = walk(SRC)
  const declarations = new Map<string, number>()
  const declFile = new Map<string, string>()
  /** 导出名 → 声明处绝对路径(判定运行时模块用) */
  const declPath = new Map<string, string>()
  const uses = new Map<string, number>()
  const specUses = new Map<string, number>()
  const bump = (m: Map<string, number>, k: string): void => void m.set(k, (m.get(k) ?? 0) + 1)

  for (const file of files) {
    const text = scriptOf(file)
    if (!text.trim()) continue
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const visit = (node: ts.Node): void => {
      const name =
        'name' in node && node.name && ts.isIdentifier(node.name as ts.Node) ? (node.name as ts.Identifier).text : null
      if (name && hasExportModifier(node)) {
        bump(declarations, name)
        if (!declFile.has(name)) declFile.set(name, posix(relative(SRC, file)))
        if (!declPath.has(name)) declPath.set(name, file)
      }
      if (ts.isVariableStatement(node) && hasExportModifier(node)) {
        for (const d of node.declarationList.declarations) {
          if (ts.isIdentifier(d.name)) {
            bump(declarations, d.name.text)
            if (!declFile.has(d.name.text)) declFile.set(d.name.text, posix(relative(SRC, file)))
            if (!declPath.has(d.name.text)) declPath.set(d.name.text, file)
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
    // .vue 模板里的表达式也算使用
    if (file.endsWith('.vue')) {
      const template = readFileSync(file, 'utf8').replace(/<script[^>]*>[\s\S]*?<\/script>/g, '')
      // 只数表达式里的词:整篇扫会把标签名当标识符(`<div>` 会让 gnum.div 看似有人用)
      const exprs: string[] = []
      for (const m of template.matchAll(/\{\{([\s\S]*?)\}\}/g)) exprs.push(m[1]!)
      for (const m of template.matchAll(/(?::|@|v-)[\w.-]*="([^"]*)"/g)) exprs.push(m[1]!)
      for (const word of exprs.join('\n').match(/[A-Za-z_$][\w$]*/g) ?? []) bump(uses, word)
    }
  }

  for (const file of files) {
    const text = scriptOf(file)
    if (!text.trim()) continue
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const isSpec = file.endsWith('.spec.ts')
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && !(node.parent && isNonUseIdentifier(node, node.parent))) {
        bump(uses, node.text)
        if (isSpec) bump(specUses, node.text)
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }

  const dead: DeadExport[] = []
  const specOnly: DeadExport[] = []
  /**
   * 运行时模块 = 从入口 main.ts 沿 import 传递可达的模块;只从 spec 够得到的整份视为审计工具。
   * 「导出被运行时用过」「被非 spec 文件 import 过」两种判据都会误报。
   */
  function resolveImport(from: string, spec: string): string | null {
    const base = spec.startsWith('@/')
      ? join(SRC, spec.slice(2))
      : spec.startsWith('.')
        // Win 路径是 `\`:两种分隔符都找
        ? join(from.slice(0, Math.max(from.lastIndexOf('/'), from.lastIndexOf('\\'))), spec)
        : null
    if (!base) return null
    for (const cand of [base, `${base}.ts`, `${base}.vue`, join(base, 'index.ts')].map(posix)) {
      if (files.includes(cand)) return cand
    }
    return null
  }
  function importsOf(file: string): string[] {
    const sf = ts.createSourceFile(file, scriptOf(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const out: string[] = []
    for (const stmt of sf.statements) {
      if (ts.isImportDeclaration(stmt) && stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)) {
        const target = resolveImport(file, stmt.moduleSpecifier.text)
        if (target) out.push(target)
      }
    }
    return out
  }
  const runtimeModules = new Set<string>()
  const entry = posix(join(SRC, 'main.ts'))
  const queue = files.includes(entry) ? [entry] : []
  while (queue.length > 0) {
    const cur = queue.pop()!
    if (runtimeModules.has(cur)) continue
    runtimeModules.add(cur)
    for (const next of importsOf(cur)) if (!runtimeModules.has(next)) queue.push(next)
  }
  for (const [name, count] of declarations) {
    // 声明处自己占一次;≤ 声明次数 ⇒ 除此之外无人提及
    const total = uses.get(name) ?? 0
    const file = declFile.get(name) ?? '?'
    if (total <= count) {
      dead.push({ name, file })
      continue
    }
    // 运行时模块里除声明外只被 spec 用到:骨架信号
    const specOnlyCount = specUses.get(name) ?? 0
    const runtimeUses = total - specOnlyCount
    const declRel = declFile.get(name) ?? ''
    if (runtimeModules.has(declPath.get(name) ?? '') && !AUDIT_MODULES.has(declRel) && runtimeUses <= count && specOnlyCount > 0) {
      specOnly.push({ name, file })
    }
  }
  const byName = (a: DeadExport, b: DeadExport): number => a.name.localeCompare(b.name)
  return {
    dead: dead.sort(byName),
    specOnly: specOnly.sort(byName),
    scanned: files.length,
    exports: declarations.size
  }
}

describe('死导出审计', () => {
  const { dead, specOnly, scanned, exports } = scanExports()
  const deadNames = dead.map(d => d.name)

  it('扫描确实跑起来了(空库不算通过)', () => {
    expect(scanned).toBeGreaterThan(200)
    expect(exports).toBeGreaterThan(500)
  })

  it('不新增死导出:写下的每个导出都得有人接', () => {
    const unexpected = dead.filter(d => !(d.name in ALLOWLIST))
    expect(
      unexpected.map(d => `${d.file} → ${d.name}`),
      '这些导出在 src 里除声明处外无人引用:接上它,或删掉它;确要保留请在 ALLOWLIST 写明原因'
    ).toEqual([])
  })

  it('豁免不常驻:已被接上的条目必须立即销账', () => {
    const stale = Object.keys(ALLOWLIST).filter(name => !deadNames.includes(name))
    expect(stale, '这些名字已经有人接了(或已删除):请从 ALLOWLIST 里删掉,名单不是博物馆').toEqual([])
  })

  /** 骨架空转豁免:运行时模块里只被 spec 用到的导出,每项须写明理由;纯审计模块不进此表 */
  const SPEC_ONLY_ALLOWLIST: Record<string, string> = {
    weatherDef: '查表原语:运行时用 todayWeather() 直接取对象,按 id 查表服务于数据自检与联动审计',
    reliefKinds: '审计汇总:把灵根的劫型解法通道列出来,供渡劫审计与灵根角色审计读',
    winChanceFromRatio: '审计公式:胜率换算只作审计口径,不进战斗结算',
    tribulationSuccessRate: '审计口径:五种劫型的抽样成功率,界面走劫势推演,不展示这一条单一概率',
    div: '数值原语:gNum 库的除法(含零除分支),gnum.spec 覆盖;库完整性优先于"当前无人调"',
    lt: '数值原语:gNum 比较,供公式单调性用例读',
    gt: '数值原语:gNum 比较,与 lt 成对',
    parseClassicalDuration: '反查原语:classicalDuration 把时长渲染成古语时制后,由它对文案做 round-trip 自检(timeUnits.spec 守卫),运行时从不解析古语文案',
    craftPeerOf: '丹药价值交叉校验:同族可炼品的药力参照,仅 pillValue.spec 读;本轮 STONE_AMT_PER_BATTLE 接进 loot 使 pillValue 成为运行时共享源,其分析导出自此进本表',
    DROP_CRAFT_RATIO: '丹药价值分析的期望炼耗比值,仅 pillValue.spec 校验原则',
    familyPeakGain: '丹药家族巅峰收益曲线,仅 pillValue.spec 校验平滑性',
    pillValueTable: '丹药价值全表,仅 pillValue.spec 断言价值预算闭环',
    fullEconomyAudit: '经济闭环审计主入口:平均每境产出/自给/死资源汇总,仅 economySim.spec 读;economySim 因 avgDustPerDrop 被离线借用而成为运行时共享源,此审计汇总不由运行时接线',
    qiFillSeconds: '灵脉充盈计时审计口径:仅 economySim.spec 校验灵所充盈曲线用时,运行时走灵脉实时投点',
    expIncomeAudit: '修为收入审计汇总:仅 expIncome.spec 读;economySim 经 expIncome 取 winsPerHour/tripExpSecsPerHour 使 expIncome 成为运行时共享源,此审计头不进运行时'
  }

  it('运行时模块里的导出,不能只被 spec 用到 —— 那是骨架空转的样子', () => {
    const unexpected = specOnly.filter(d => !(d.name in SPEC_ONLY_ALLOWLIST))
    expect(
      unexpected.map(d => `${d.file} → ${d.name}`),
      '这些导出只在 spec 里出现:要么接进游戏(像本轮的道侣因果、技艺表),要么删掉;确要保留请写明理由'
    ).toEqual([])
  })

  it('骨架豁免同样不常驻:已接上或已删除的,从名单销账', () => {
    const names = specOnly.map(d => d.name)
    const stale = Object.keys(SPEC_ONLY_ALLOWLIST).filter(n => !names.includes(n))
    expect(stale, '这些已经不再是"只在 spec 里出现"了:请从 SPEC_ONLY_ALLOWLIST 删掉').toEqual([])
  })
})
