/**
 * VIP 修行开销:有效期内九折。
 *
 * 为什么折算落在**成本**上,而不是扣款方法里:
 * `spendSmall('herb', 3)` 若打九折,「交出 3 株」就变成「交出 2 株」,而坊市回收价照旧 ——
 * 买卖两侧不对称,便是一条「九折收进来、原价卖回去」的套利;`invested` 记的也仍是全价,
 * 强化再分解能把折让退第二遍。所以折算一律乘在「生成成本」那一处:价签、置灰判据、
 * 结算、服务端记账读的是同一个数。
 *
 * 不含:坊市买卖(含 sellPill / sellMaterial / sellHerb 的回收)、任务上交材料 ——
 * 那是物物交换,不是修行开销。
 */
import type { GNum } from '@/types'
import { mulN } from '@/utils/gnum'

/** 九折 */
export const VIP_SPEND_RATE = 0.9

/**
 * 当前是否按 VIP 计价。
 *
 * 客户端由 App.vue 注入 `() => useAuthStore().isVip`(惰性读,不缓存布尔 ——
 * 到期那一刻就该停);服务端水合云档时没有 auth 分片(见 core/forgeResolve 的
 * HYDRATED_SLICES),由 resolveForgeFromSlices 按 users.vip_until 显式注入,结算完复位。
 * 未注入即原价:所有纯账层 spec 因此不必先开一张月卡。
 */
let vipResolver: (() => boolean) | null = null

export function setVipResolver(fn: (() => boolean) | null): void {
  vipResolver = fn
}

/**
 * 取当前注入器。服务端无头结算要临时改成「本单是不是 VIP」,完事再还原上一个 ——
 * 直接置 null 会把客户端注入的那个也抹掉。
 */
export function getVipResolver(): (() => boolean) | null {
  return vipResolver
}

/** 有效期内 0.9,否则 1。每次现算 */
export function spendRate(): number {
  try {
    return vipResolver?.() === true ? VIP_SPEND_RATE : 1
  } catch {
    return 1
  }
}

/** 灵石/修为这类大数的折后价;零值与非大数原样返回(交给调用方原有的容错) */
export function cutGNum(v: GNum): GNum {
  const rate = spendRate()
  if (rate === 1) return v
  if (!v || !Number.isFinite(v.m) || !Number.isFinite(v.e)) return v
  return mulN(v, rate)
}

/**
 * 件数类成本(器灵尘 / 灵草 / 玄铁 / 悟道页 / 悟道点 / 修为点)的折后价。
 * 向上取整:3 株草九折仍是 3 株 —— 小额开销不因折让变成白送。
 */
export function cutCount(n: number): number {
  const rate = spendRate()
  if (rate === 1 || !Number.isFinite(n) || n <= 0) return n
  return Math.max(1, Math.ceil(n * rate))
}
