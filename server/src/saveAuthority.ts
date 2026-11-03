/**
 * 服务端数值权威化:动态加载客户端共享模块 core/saveAuthority,对归一化后的存档做裁决。
 *
 * 为什么和服务端复算、归一化一样走动态 import:
 *   客户端模块用 `@/` 别名与 bundler 解析,服务端 tsc(NodeNext)跟进去会把整个 src 图
 *   卷进类型检查,DOM/环境差异全是假错。运行时由 tsx 的 tsconfig paths 解析,没问题。
 *
 * 返回 null 表示「没裁决成」(模块加载失败/链路抛错):调用方按归一化结果落库 ——
 * 权威化是加固,不是存档的前置条件,不能因为它坏了而拒收存档。
 */
import { loadClientModule } from './clientVendor.js'

const SOURCE_MODULE = '../../src/core/saveAuthority'
const VENDOR_FILE = 'saveAuthority'

export interface AuthorityCorrection {
  path: string
  before: unknown
  after: unknown
}

export interface AuthorityReport {
  data: Record<string, unknown>
  corrections: AuthorityCorrection[]
  notes: string[]
}

interface AuthorityInput {
  prev: Record<string, unknown> | null
  next: Record<string, unknown>
  prevRealmIndex: number
  elapsedMs: number
  /** 1.57.0+ 客户端标记:境界只认 profiles,上传里的 major/sub 不采信(转世除外) */
  realmAuthoritative?: boolean
}

type AuthorityFn = (input: AuthorityInput) => AuthorityReport | null

let cached: Promise<{ enforceSaveAuthority: AuthorityFn }> | null = null

function clientAuthority(): Promise<{ enforceSaveAuthority: AuthorityFn }> {
  cached ??= loadClientModule<{ enforceSaveAuthority: AuthorityFn }>(SOURCE_MODULE, VENDOR_FILE)
  return cached
}

/** 裁决一份已归一化的存档;失败返回 null(调用方按归一化结果落库) */
export async function enforceAuthority(input: AuthorityInput): Promise<AuthorityReport | null> {
  try {
    const mod = await clientAuthority()
    return mod.enforceSaveAuthority(input)
  } catch (err) {
    console.warn('[save] 数值权威化失败,按归一化结果落库:', err instanceof Error ? err.message : err)
    return null
  }
}
