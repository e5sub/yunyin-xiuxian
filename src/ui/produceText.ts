/** 地界物产阶位;与 region.tier 同源(afterWin / 离线结算 / 镇压产出喂给 generateEquipment 的同一档) */
export function produceTierText(tier: number): string {
  return `产 ${tier} 阶`
}
