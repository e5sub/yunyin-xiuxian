/**
 * 服务端存档归一化:动态加载客户端共享模块 core/saveSanitize,
 * 用上传的分片无头水合同一批 store、跑同一套 sanitize(与客户端读档自愈同源)。
 *
 * 与 recompute.ts 同样的动态 import 理由:客户端模块走 `@/` 别名与 bundler 解析,
 * 服务端 tsc(NodeNext)跟进去会把整个 src 图卷进类型检查,DOM/环境差异全是假错。
 *
 * 返回 null 表示「没归一化」(模块加载失败/分片畸形到链路抛错):
 * 调用方按原样落库 —— 归一化是加固,不是存档的前置条件,不能因为它坏了而拒收存档。
 */
import { loadClientModule } from './clientVendor.js'
const SOURCE_MODULE = '../../src/core/saveSanitize'
const VENDOR_FILE = 'saveSanitize'

interface SanitizeReport {
  data: Record<string, unknown>
  touched: string[]
}

let cached: Promise<{ sanitizeSaveSlices: (data: unknown) => SanitizeReport | null }> | null = null

function clientSanitize(): Promise<{ sanitizeSaveSlices: (data: unknown) => SanitizeReport | null }> {
  cached ??= loadClientModule(SOURCE_MODULE, VENDOR_FILE)
// 加载失败不缓存 rejected promise:vendor 缺失/损坏是部署事故,修好后不该重启进程才恢复
  cached.catch(() => {
    cached = null
  })
  return cached
}

/** 归一化存档分片;失败返回 null(调用方按原样落库) */
export async function normalizeSaveSlices(data: unknown): Promise<SanitizeReport | null> {
  try {
    const mod = await clientSanitize()
    return mod.sanitizeSaveSlices(data)
  } catch (err) {
    console.warn('[save] 存档归一化失败,按原样落库:', err instanceof Error ? err.message : err)
    return null
  }
}
