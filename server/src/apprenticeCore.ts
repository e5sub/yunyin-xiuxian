/**
 * 弟子差事记账(1.74.1)的共享纯账层:动态加载客户端 core/apprenticeService。
 * 与 lootGrant/recompute 同样走动态 import:客户端模块用 `@/` 别名,服务端 tsc 不跟随;
 * 运行时吃 server/vendor bundle。加载失败按 null 处理,调用方对玩家回「记账不可用」——
 * 宁可不派这趟差事,不可无据收割。
 */
import { loadClientModule } from './clientVendor.js'

const SOURCE_MODULE = '../../src/core/apprenticeService'
const VENDOR_FILE = 'apprenticeService'

/** 一趟差事的服端产出(TaskSpoils 形状;stone 是 {m,e} 大数) */
export type ServerSpoils = Record<string, unknown>

interface ApprenticeCore {
  isApprenticeArch: (archId: string) => boolean
  apprenticeSpoils: (archId: string, spec: string, major: number, level: number) => ServerSpoils
  apprenticeTaskSeconds: (spec: string) => number
}

let cached: Promise<ApprenticeCore | null> | null = null

function core(): Promise<ApprenticeCore | null> {
  cached ??= loadClientModule<ApprenticeCore>(SOURCE_MODULE, VENDOR_FILE).catch(() => null)
  return cached
}

/** archId 是不是真门派 */
export async function isApprenticeArch(archId: string): Promise<boolean> {
  const mod = await core()
  return mod !== null && mod.isApprenticeArch(archId)
}

/** 一趟差事的秒数;spec 不认识返回 -1 */
export async function apprenticeTaskSeconds(spec: string): Promise<number> {
  const mod = await core()
  if (mod === null) return -1
  try {
    const s = mod.apprenticeTaskSeconds(spec)
    return Number.isFinite(s) && s > 0 ? Math.trunc(s) : -1
  } catch {
    return -1
  }
}

/** 复算一趟差事的产出;任何一步不合法返回 null(调用方宁可白点一次) */
export async function computeApprenticeSpoils(
  archId: string,
  spec: string,
  major: number,
  level: number
): Promise<ServerSpoils | null> {
  const mod = await core()
  if (mod === null) return null
  try {
    return mod.apprenticeSpoils(archId, spec, major, level)
  } catch {
    return null
  }
}
