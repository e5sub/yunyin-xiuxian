/**
 * 镇压装备运气的纯函数单点(零依赖)。
 *
 * 为什么单独成模块:lootGrant(会被打成 Node bundle 随镜像分发,见 package.json build:vendor)
 * 只需要这条运气公式,却曾被 迫 连带拖进 suppress.ts → loot.ts → lootClaim → services/cloud
 * 的浏览器链路,vendor bundle 里混入 import.meta.env 在 Node 里一装载就炸。
 * 纯公式落在这处,suppress.ts 与 lootGrant 都从这里取;suppress.ts 再导出保住旧引用面。
 */

/** 老镇压区装备运气:每镇满一天 +0.1,封顶 +0.8 */
export const SUPPRESS_EQUIP_LUCK_CAP = 0.8
export const SUPPRESS_EQUIP_LUCK_PER_DAY = 0.1

/** 老镇压区的装备运气;坏档(非有限、未来时刻)夹到 0,防负运气或 NaN 进品质权重 */
export function suppressionEquipmentLuck(sinceMs: number, nowMs: number): number {
  const days = Math.floor(Math.max(0, nowMs - sinceMs) / 86_400_000)
  if (!Number.isFinite(days)) return 0
  return Math.min(SUPPRESS_EQUIP_LUCK_CAP, days * SUPPRESS_EQUIP_LUCK_PER_DAY)
}
