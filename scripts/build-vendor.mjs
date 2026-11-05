/**
 * 服务端 vendor bundle:把 core 里服务端要复用的纯账层/裁决模块打成 Node ESM。
 *
 * 运行时镜像只复制 server/,没有 src/ 源码 —— 拿不到源码时 server/src/clientVendor.ts
 * 会回落到 server/vendor/*.mjs。少打一个入口,对应功能就在容器里静默失效:
 * 1.58.3(forgeResolve)与 1.59.0(levelResolve)都曾因为 Dockerfile 里的手写清单没跟上而漏过。
 *
 * 入口清单只此一处:package.json 的 build:vendor、Dockerfile、Dockerfile.ci 与 CI 全走本脚本。
 */
import { build } from 'esbuild'

const ENTRY_POINTS = [
  'src/core/saveSanitize.ts',
  'src/core/saveAuthority.ts',
  'src/core/profileRecompute.ts',
  'src/core/breakthroughResolve.ts',
  'src/core/lootGrant.ts',
  'src/core/forgeResolve.ts',
  'src/core/levelResolve.ts'
]

await build({
  entryPoints: ENTRY_POINTS,
  bundle: true,
  platform: 'node',
  format: 'esm',
  outdir: 'server/vendor',
  outbase: 'src/core',
  outExtension: { '.js': '.mjs' },
  tsconfig: 'tsconfig.app.json',
  legalComments: 'none'
})

console.log(`[build-vendor] ${ENTRY_POINTS.length} 个模块 -> server/vendor/`)

// 打包后逐个在 Node 里装载并断言调用方要解构的导出确实存在:
// vendor 的传递依赖图极深(一层打包牵进 17 个 store),任何一层新增浏览器专属顶层代码
// (window/document/import.meta.env 直读)都只有线上首次调用才会炸 —— 必须在这里拦住。
const EXPECTED = {
  'saveSanitize.mjs': ['sanitizeSaveSlices'],
  'saveAuthority.mjs': ['enforceSaveAuthority'],
  'profileRecompute.mjs': ['snapshotFromSlices', 'lootEnvFromSlices'],
  'breakthroughResolve.mjs': ['resolveBreakthroughFromSlices'],
  'lootGrant.mjs': ['grantEquips', 'validateExtraGains', 'marketPriceAt'],
  'forgeResolve.mjs': ['resolveForgeFromSlices'],
  'levelResolve.mjs': ['resolveLevelFromSlices']
}

let failed = false
for (const [file, names] of Object.entries(EXPECTED)) {
  try {
    const mod = await import(new URL(`../server/vendor/${file}`, import.meta.url))
    for (const name of names) {
      if (typeof mod[name] !== 'function') {
        console.error(`[build-vendor] ${file} 缺导出 ${name} —— 服务端调用方会拿到 undefined`)
        failed = true
      }
    }
  } catch (err) {
    console.error(`[build-vendor] ${file} 在 Node 里装不起来:`, err instanceof Error ? err.message : err)
    failed = true
  }
}
if (failed) process.exit(1)
console.log('[build-vendor] 冒烟通过:7 个入口全部可装载、导出齐全')
