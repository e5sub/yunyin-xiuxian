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
