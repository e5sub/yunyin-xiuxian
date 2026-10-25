/**
 * 脚本依赖审计:scripts/ 下的第三方裸模块 import 须在 package.json 声明(相对路径、node: 内置模块不算)。
 * CI 不跑这些脚本,文档自检只核命令存在;本机残留的全局安装会掩盖漏声明,干净 clone 上 Cannot find package。
 * 故障注入:在 scripts/ 里新建一个 `import sharp from 'sharp'` 的空脚本 → 第二条红。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(__dirname, '../..')
const PKG = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8')) as {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}
const DECLARED = new Set([
  ...Object.keys(PKG.dependencies ?? {}),
  ...Object.keys(PKG.devDependencies ?? {})
])

function scriptFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue
      scriptFiles(full, out)
    } else if (/\.(mjs|ts)$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

/** node 内置模块的裸名写法 */
const BUILTINS =
  /^(?:assert|buffer|child_process|cluster|crypto|dgram|dns|events|fs|http|https|module|net|os|path|perf_hooks|process|querystring|readline|stream|string_decoder|timers|tls|tty|url|util|v8|vm|worker_threads|zlib)(?:\/|$)/

/** 脚本里的第三方裸模块名,去子路径(`playwright/test` → `playwright`) */
function bareImports(src: string): string[] {
  const out: string[] = []
  const patterns = [
    /(?:^|\n)\s*import\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g,
    /(?:^|\n)\s*export\s+[\s\S]*?\s+from\s+["']([^"']+)["']/g,
    /\bimport\(\s*["']([^"']+)["']\s*\)/g
  ]
  for (const re of patterns) {
    for (const m of src.matchAll(re)) {
      const spec = m[1]!
      if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:')) continue
      if (BUILTINS.test(spec)) continue
      out.push(spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]!)
    }
  }
  return out
}

const FILES = scriptFiles(resolve(ROOT, 'scripts'))

describe('脚本依赖 · 干净 clone 上也要跑得起来', () => {
  it('扫到了脚本(否则下面的断言在替空集合站岗)', () => {
    expect(FILES.length).toBeGreaterThan(10)
    expect(FILES.some(f => f.endsWith('gen-pwa-icons.mjs'))).toBe(true)
  })

  it('scripts/ 里的第三方 import 全都在 package.json 里声明过', () => {
    const missing: string[] = []
    for (const file of FILES) {
      const rel = file.slice(ROOT.length + 1).replace(/\\/g, '/')
      for (const name of bareImports(readFileSync(file, 'utf-8'))) {
        if (!DECLARED.has(name)) missing.push(`${rel} → ${name}`)
      }
    }
    expect(
      missing,
      `这些依赖没进 package.json,干净 clone 上会 Cannot find package:\n${missing.join('\n')}`
    ).toEqual([])
  })

  it('判据自证:能认出裸模块名,也不会把相对路径 / node 内建误报', () => {
    const sample = [
      "import sharp from 'sharp'",
      "import { chromium } from 'playwright'",
      "import { readFileSync } from 'node:fs'",
      "import { join } from 'path'",
      "import local from './lib/saveFixture.mjs'",
      "const lazy = await import('crypto-js')"
    ].join('\n')
    expect(bareImports(sample).sort()).toEqual(['crypto-js', 'playwright', 'sharp'])
  })
})
