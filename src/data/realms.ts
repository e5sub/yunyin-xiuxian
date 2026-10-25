/**
 * 境界体系 —— 四大界域 · 21 大境界 × (九层 + 圆满)
 *
 * 下标 = 大境界序号 major。兼容约束:0-9 号境界的 id/名称/寿元/desc 保持原值不动
 * (存档、内容 gate(minRealm)、审计口径都建立在旧下标上);新界只追加,不改旧序号。
 */
import type { RealmDef, WorldId } from '@/types'

export interface WorldDef {
  id: WorldId
  name: string
  desc: string
  /** 起始大境界序号(含) */
  start: number
  /** 结束大境界序号(含) */
  end: number
}

export const WORLDS: WorldDef[] = [
  { id: 'mortal', name: '人间界', desc: '凡尘俗世,修士自此一步步叩问长生', start: 0, end: 8 },
  { id: 'immortal', name: '仙界', desc: '飞升之地,仙灵之气充盈,一步一登天', start: 9, end: 13 },
  { id: 'god', name: '神界', desc: '神域之中,法则凝形', start: 14, end: 17 },
  { id: 'chaos', name: '混沌海', desc: '万界之始,大道本源', start: 18, end: 20 }
]

/** 寿元:界域内按固定倍率复利,跨界一次大跃;spec 钉:realms.spec(单调、每境至少翻倍、飞升为唯一大跃) */
export const LIFESPAN_WORLDS: Record<WorldId, { base: number; growth: number; start: number }> = {
  mortal: { base: 150, growth: 3.0, start: 0 },
  immortal: { base: 100_000_000, growth: 3.2, start: 9 },
  god: { base: 100_000_000_000, growth: 4.5, start: 14 },
  chaos: { base: 50_000_000_000_000, growth: 4.5, start: 18 }
}

/** 某大境界的寿元 */
export function lifespanOf(major: number): number {
  const m = Math.max(0, Math.min(WORLDS[WORLDS.length - 1]!.end, major))
  const w = WORLDS.find(x => m >= x.start && m <= x.end) ?? WORLDS[0]!
  const cfg = LIFESPAN_WORLDS[w.id]
  return Math.round(cfg.base * Math.pow(cfg.growth, m - cfg.start))
}

/** 飞升大跃倍数:渡劫 → 真仙的寿元倍数。文案里「约 ×N」须读此值,不手写 */
export function ascensionLeap(): number {
  const mortal = WORLDS[0]!
  const immortal = WORLDS[1]!
  return Math.round(lifespanOf(immortal.start) / lifespanOf(mortal.end))
}

export const REALMS: RealmDef[] = [
  // 大关皆劫:筑基起每个大境界(含真仙/神人/混沌真灵三个跨界入口)一律渡天劫,
  // 境界数据不设 per-realm 的 `tribulation` 开关;见 core/breakthrough、core/tribulationDecision。
  // ---- 人间界 ----
  { id: 'lianqi', name: '炼气', world: 'mortal', lifespanYears: lifespanOf(0), desc: '引气入体,踏上仙途', lore: '起点取网文最常见的「炼气」,即吐纳导引,对应道家「服气」之说。', basis: '内丹' },
  { id: 'zhuji', name: '筑基', world: 'mortal', lifespanYears: lifespanOf(1), desc: '筑道之基,凡躯渐蜕', lore: '承炼气。《周易参同契》讲「筑基炼己」,基成方可结丹。', basis: '内丹' },
  { id: 'jindan', name: '金丹', world: 'mortal', lifespanYears: lifespanOf(2), desc: '丹成一粒,吞吐天地', lore: '承筑基。内丹术中「金丹」为药,张伯端《悟真篇》以金丹喻道。', basis: '内丹' },
  { id: 'yuanying', name: '元婴', world: 'mortal', lifespanYears: lifespanOf(3), desc: '婴现顶门,神游太虚', lore: '承金丹。《性命圭旨》述「婴儿现形」,金丹化婴,是为元婴。', basis: '内丹' },
  { id: 'huashen', name: '化神', world: 'mortal', lifespanYears: lifespanOf(4), desc: '神念化形,言出法随', lore: '承元婴。《性命圭旨》「炼气化神」,神念离体。', basis: '内丹' },
  { id: 'lianxu', name: '炼虚', world: 'mortal', lifespanYears: lifespanOf(5), desc: '炼神返虚,窥见大道', lore: '承化神。《性命圭旨》「炼神还虚」,即炼虚。', basis: '内丹' },
  { id: 'heti', name: '合体', world: 'mortal', lifespanYears: lifespanOf(6), desc: '身道相合,举念移山', lore: '承炼虚。内丹谓「形神俱妙」,是为合体。', basis: '内丹' },
  { id: 'dacheng', name: '大乘', world: 'mortal', lifespanYears: lifespanOf(7), desc: '大道将成,静候天命', lore: '承合体。取佛教「大乘」之名。', basis: '佛道' },
  { id: 'dujie', name: '渡劫', world: 'mortal', lifespanYears: lifespanOf(8), desc: '九重雷海,向死而生', lore: '承大乘。《云笈七签》有雷劫之说,修至尽头须渡此劫。', basis: '佛道' },
  // ---- 仙界 ----
  { id: 'zhenxian', name: '真仙', world: 'immortal', lifespanYears: lifespanOf(9), desc: '超脱轮回,与道同存', lore: '承渡劫。《钟吕传道集》分仙为五等,天仙之上为真仙。', basis: '道教仙阶' },
  { id: 'xuanxian', name: '玄仙', world: 'immortal', lifespanYears: lifespanOf(10), desc: '仙体玄妙,一念山河', lore: '承真仙。取其「玄」字(《道德经》「玄之又玄」)。', basis: '道教仙阶' },
  { id: 'jinxian', name: '金仙', world: 'immortal', lifespanYears: lifespanOf(11), desc: '金性不朽,历劫不磨', lore: '承玄仙。道教称「金仙」为历劫不磨之仙。', basis: '道教仙阶' },
  { id: 'taiyi', name: '太乙', world: 'immortal', lifespanYears: lifespanOf(12), desc: '太乙近道,万法归流', lore: '承金仙。取道教「太乙」(太乙救苦天尊)与网文近道之阶。', basis: '道教仙阶' },
  { id: 'daluo', name: '大罗', world: 'immortal', lifespanYears: lifespanOf(13), desc: '大罗金仙,逍遥三界', lore: '承太乙。道教以「大罗天」为最高天界,居其上者为大罗金仙。', basis: '道教仙阶' },
  // ---- 神界 ----
  { id: 'shenren', name: '神人', world: 'god', lifespanYears: lifespanOf(14), desc: '神光照世,超脱仙凡', lore: '承大罗。《庄子·逍遥游》「藐姑射之山,有神人居焉」。', basis: '道家本源' },
  { id: 'shenjiang', name: '神将', world: 'god', lifespanYears: lifespanOf(15), desc: '执掌神兵,代天行罚', lore: '承神人。神界阶位常见「神将」。', basis: '网文' },
  { id: 'shenwang', name: '神王', world: 'god', lifespanYears: lifespanOf(16), desc: '神域之主,言出法随', lore: '承神将。一方神域之主为神王。', basis: '网文' },
  { id: 'shendi', name: '神帝', world: 'god', lifespanYears: lifespanOf(17), desc: '神帝临尘,众神俯首', lore: '承神王。众神之极曰神帝。', basis: '网文' },
  // ---- 混沌海 ----
  { id: 'hundunling', name: '混沌真灵', world: 'chaos', lifespanYears: lifespanOf(18), desc: '混沌初开,一点真灵不昧', lore: '承神帝。《三五历纪》「天地混沌如鸡子」。', basis: '道家本源' },
  { id: 'hundunshenmo', name: '混沌神魔', world: 'chaos', lifespanYears: lifespanOf(19), desc: '神魔一体,开天辟地', lore: '承混沌真灵。神魔以身开界。', basis: '道家本源' },
  { id: 'hundundaozu', name: '混沌道祖', world: 'chaos', lifespanYears: lifespanOf(20), desc: '万道之祖,与混沌同寿', lore: '承混沌神魔,为全境之极。《道德经》「道生一」。', basis: '道家本源' }
]

export const MAX_MAJOR = REALMS.length - 1

/** 仙界起点(飞升门槛)。天界终局内容(道途/远征/试炼/熔炉)以此为准,不借用「满级」(每加一境门槛会漂移) */
export const WORLD_BREAK_MAJOR = 9

/** 轮回(道果 / 天赋)经济的参照终点:「修满一世」以飞升真仙计,仙界以上属另一套经济;轮回 ROI / 道果曲线一族审计以此为基线 */
export const REBIRTH_REFERENCE_MAJOR = WORLD_BREAK_MAJOR

export const SUB_NAMES = ['一层', '二层', '三层', '四层', '五层', '六层', '七层', '八层', '九层', '圆满'] as const

export function realmDef(major: number): RealmDef {
  return REALMS[Math.max(0, Math.min(MAX_MAJOR, major))]!
}

/** 完整境界名,如「金丹·三层」 */
export function realmLabel(major: number, sub: number): string {
  const r = realmDef(major)
  const s = SUB_NAMES[Math.max(0, Math.min(SUB_NAMES.length - 1, sub))]
  return `${r.name}·${s}`
}

const WORLD_BY_ID = new Map(WORLDS.map(w => [w.id, w]))

export function worldDef(id: WorldId): WorldDef {
  return WORLD_BY_ID.get(id) ?? WORLDS[0]!
}

export function worldOf(major: number): WorldDef {
  const m = Math.max(0, Math.min(MAX_MAJOR, major))
  return WORLDS.find(w => m >= w.start && m <= w.end) ?? WORLDS[WORLDS.length - 1]!
}

/** 是否为所在界域的第一境(跨界那一境) */
export function isWorldEntry(major: number): boolean {
  return worldOf(major).start === Math.max(0, Math.min(MAX_MAJOR, major))
}
