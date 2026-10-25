/** 器魂页文案(凝炼代价与余额、散去不可逆);页面模板只许调用不许手打(soulText.spec 钉) */
export function refineCostLine(cost: number, balanceText: string): string {
  return `入炉毁原器 · 耗道源 ${cost} · 现有 ${balanceText}`
}

export function dissolveNote(): string {
  return '散去不可逆 · 道源不返'
}
