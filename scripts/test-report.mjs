/** 分类测试报告:按类输出 PASS/FAIL。用法:bun run test:report */
import { execSync } from 'node:child_process'
import { readFileSync, readdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { TEST_CATEGORIES, classifySpecPath } from './testCategories.ts'

const OUT = '.vitest-report.json'
const ROOT = resolve(import.meta.dirname, '..')

/**
 * 文档不写用例条数(每加删一条就变);规模只记 spec 文件数(由 `bun run docs-check` 校验)。
 * 豁免:行内写明这条规则本身的(含「不许写例数」等说法)。代码块不豁免,否则命令示例里的例数漏检。
 */
const DOC_FILES = [
  { rel: 'README.md', file: join(ROOT, 'README.md') },
  ...readdirSync(join(ROOT, 'docs'), { recursive: true, encoding: 'utf-8' })
    .filter(name => typeof name === 'string' && name.endsWith('.md'))
    .map(name => `docs/${name}`)
    // 参考仓学习笔记引的是 xian 的读数
    .filter(rel => !rel.startsWith('docs/superpowers/plans/') && rel !== 'docs/study-xian.md')
    .map(rel => ({ rel, file: join(ROOT, rel) })),
  { rel: 'AGENTS.md', file: join(ROOT, 'AGENTS.md') },
]

function caseCountHits(text) {
  const hits = []
  text.split(/\r?\n/).forEach((line, i) => {
    if (/(不许写例数|用例条数不写进文档|不写进文档)/.test(line)) return
    // 只认用例数写法:裸「条」是通用量词不算;英文后缀(tests/cases…)也算,其后须无字母
    if (/(\d[\d,]*)\s*(例|个用例|条用例|个断言|条断言)|\b(\d[\d,]*)\s*(?:tests?|cases?|specs?|assertions?)\b/i.exec(line)) {
      hits.push(`第 ${i + 1} 行: ${line.trim().slice(0, 80)}`)
    }
  })
  return hits
}

// CI 的 4 vCPU runner 上 169 个文件全量并行,worker 内存顶爆会整组打断:
// 2026-10-05 一轮 PR 连续两次同一批 8 条 exploration 战败用例被打断,本地任何
// 配置(含 --pool=forks --maxWorkers=4)都全绿,改为流式输出后同一份代码当场即绿 ——
// 是负荷态下的 worker 中断,不是逻辑败。合入闸门不许靠运气,故 CI 限核:
// 本地不设 CI 变量时按机器核心数全速,两边的判据仍是同一份 JSON。
const CI_WORKERS = process.env.CI ? ' --maxWorkers=4' : ''
try {
  execSync(`bunx vitest run --reporter=json${CI_WORKERS} --outputFile=${OUT}`, { stdio: 'pipe' })
} catch {
  // 有测试失败时 vitest 以非零码退出,报告文件仍会生成
}

let report
try {
  report = JSON.parse(readFileSync(OUT, 'utf8'))
} catch {
  console.error('未能读取测试报告,请先确认 bunx vitest run 可正常执行')
  process.exit(1)
}
rmSync(OUT, { force: true })

const rows = TEST_CATEGORIES.map(c => ({ ...c, passed: 0, failed: 0 }))
let uncategorized = 0
/** 未登记的文件与失败的用例都要点名 —— 这份报告现在是 CI 的门,只给个数字没法修 */
const uncategorizedFiles = []
const failures = []

const docFailures = []
for (const { rel, file } of DOC_FILES) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    continue
  }
  for (const hit of caseCountHits(text)) {
    docFailures.push(`${rel} ${hit} —— 文档只记 spec 文件数,用例条数不写进文档`)
  }
}

for (const file of report.testResults ?? []) {
  // Windows 上 vitest 报反斜杠;不统一则目录级条目('/ui/')只在 CI 命中
  const path = String(file.name ?? '').split('\\').join('/')
  const category = classifySpecPath(path)
  const row = category ? rows.find(c => c.name === category.name) : undefined
  const passed = (file.assertionResults ?? []).filter(a => a.status === 'passed').length
  const failed = (file.assertionResults ?? []).filter(a => a.status === 'failed').length
  const short = path.replace(/^.*\/src\//, 'src/')
  for (const a of file.assertionResults ?? []) {
    if (a.status === 'failed') failures.push(`${short} › ${a.fullName ?? a.title}`)
  }
  if (row) {
    row.passed += passed
    row.failed += failed
  } else {
    uncategorized += passed + failed
    uncategorizedFiles.push(short)
  }
}

console.log('\n—— 《云隐修仙录》分类测试报告 ——\n')
let totalPassed = 0
for (const row of rows) {
  totalPassed += row.passed
  const status = row.failed > 0 ? 'FAIL' : 'PASS'
  const mark = row.failed > 0 ? '✗' : '✓'
  console.log(`  ${mark} ${row.name.padEnd(22, ' ')} ${status}  (${row.passed} 过${row.failed ? ` / ${row.failed} 败` : ''})`)
}
if (uncategorized > 0) {
  console.log(`  ✗ 未分类用例 ${uncategorized} 个 —— 请在 scripts/test-report.mjs 的 CATEGORIES 中补充映射:`)
  for (const f of uncategorizedFiles) console.log(`      ${f}`)
}
if (failures.length > 0) {
  console.log(`\n  失败用例(${failures.length}):`)
  for (const f of failures) console.log(`    ✗ ${f}`)
}
if (docFailures.length > 0) {
  console.log('\n  ✗ 文档里又写回了用例条数(它每次都变,不该记在文档里):')
  for (const f of docFailures) console.log(`      ${f}`)
}
// 败数取逐条点名数:未登记文件的失败不进任何一类,按类汇总会漏
console.log(`\n  共 ${totalPassed} 过 / ${failures.length} 败\n`)
// 未分类、文档例数同样判失败:只提示不拦会悄悄累积
if (docFailures.length > 0) {
  console.log('  退出码 1 的原因:文档里又写回了用例条数\n')
}
process.exit(failures.length > 0 || uncategorized > 0 || docFailures.length > 0 ? 1 : 0)
