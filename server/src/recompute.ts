/**
 * 服务端复算档案快照:动态加载客户端共享模块 core/profileRecompute,
 * 用上传的存档分片无头水合 store、跑同一份 finalStats 链。
 *
 * 为什么动态 import 且不写静态类型:客户端模块走 `@/` 别名与 bundler 式解析,
 * 服务端 tsc(NodeNext)跟进去会把整个 src 图卷进类型检查,DOM/环境差异全是假错;
 * 这里故意用 string 型变量当说明符让 tsc 不跟随,运行时由 tsx 的 tsconfig paths 解析。
 * 复算任何一步失败都返回 null,调用方(save.ts)回落到旧的钳制快照 —— 宁可宽,不可崩。
 */
import { loadClientModule } from './clientVendor.js'

const SOURCE_MODULE = '../../src/core/profileRecompute'
const VENDOR_FILE = 'profileRecompute'

export interface LootEnv {
  major: number
  dropRate: number
  luck: number
  doubleDropRate: number
  petDropLuck: number
}

interface RecomputeModule {
  snapshotFromSlices: (data: unknown) => Record<string, unknown> | null
  lootEnvFromSlices: (data: unknown) => LootEnv | null
}

let cached: Promise<RecomputeModule> | null = null

function clientRecompute(): Promise<RecomputeModule> {
  cached ??= loadClientModule<RecomputeModule>(SOURCE_MODULE, VENDOR_FILE)
// 加载失败不缓存 rejected promise:vendor 缺失/损坏是部署事故,修好后不该重启进程才恢复
  cached.catch(() => {
    cached = null
  })
  return cached
}

/** 从存档分片复算档案快照;失败返回 null(调用方回落钳制快照) */
export async function recomputeProfile(data: unknown): Promise<Record<string, unknown> | null> {
  try {
    const mod = await clientRecompute()
    return mod.snapshotFromSlices(data)
  } catch (err) {
    // 模块加载/水合失败要留痕:静默回落等于复算永远不生效,坏档只能在 GM 后台看出属性「没被复算」
    console.warn('[recompute] 档案快照复算失败,回落客户端快照:', err instanceof Error ? err.message : err)
    return null
  }
}

/**
 * 从存档分片复算掉落签发环境(/api/loot/claim 用):数量与品质裁决全看这份属性。
 * 复算不出(分片畸形/模块加载失败)返回 null —— 掉落宁可不发,也不按客户端自报的
 * dropRate/luck 签发;与复算快照同一份无头水合链,不存在第二套口径。
 */
export async function lootEnv(data: unknown): Promise<LootEnv | null> {
  try {
    const mod = await clientRecompute()
    return mod.lootEnvFromSlices(data)
  } catch (err) {
    console.warn('[loot] 掉落环境复算失败,本次不签发:', err instanceof Error ? err.message : err)
    return null
  }
}
