/**
 * 内容可达性审计:深修回报须是金丹路线重复轮回拿不到(或拿不到同等)的内容。
 * 逐类追代码而非看 UI:境界门槛、金丹无限轮回能否全部拿走、有无绕过路径(师承/奇遇/掉落/知识继承)。
 * 前提(reincarnation.confirmReincarnation):认知层(lore)与成就图鉴完全跨世保留,功法门类保留、层数回到一层;
 * 境界门槛是一次性的,跨过一次即永久留在账上。
 */
import { PILLS } from '@/data/pills'
import { GONGFA } from '@/data/gongfa'
import { REGIONS } from '@/data/regions'
import { EVENTS } from '@/data/events'
import { chainOfEvent } from '@/data/chains'
import { PETS } from '@/data/pets'
import { MENTORS } from '@/data/mentors'
import { WORLD_BREAK_MAJOR } from '@/data/realms'
import { qualityDef } from '@/data/qualities'
import { MANUAL_REBIRTH_MIN_MAJOR } from './reincarnation'

/**
 * 区域随机池里的事件,不含奇缘阶段(奇缘不属于任何地界、不进随机池,见 eventEngine.regionEventPoolFor)。
 * 混在一起算会让这条判据随内容量浮动。
 */
const POOL_EVENTS = EVENTS.filter(e => chainOfEvent(e.id) === null)

/** 门槛的性质 */
export type GateKind =
  /** 最低获得境界:低于此境界拿不到 */
  | 'acquire'
  /** 最低使用境界:能拿到但用不了 */
  | 'use'
  /** 最低触发境界:内容存在但事件不会出现 */
  | 'trigger'
  | 'none'

export interface ContentGate {
  id: string
  name: string
  kind: GateKind
  /** 最低境界(none 时为 0) */
  minMajor: number
  /** 代码依据 */
  evidence: string
  /** 金丹玩家无限轮回是否最终能全部拿到 */
  reachableByGoldRebirth: boolean
  /** 是否存在绕过门槛的路径 */
  bypass: string | null
  /** 能否作为深修独有回报 */
  qualifies: boolean
}

const GOLD = MANUAL_REBIRTH_MIN_MAJOR

/** 某类内容中,超出金丹可达范围的条目数 */
function beyondGold(items: readonly { minRealm?: number }[]): number {
  return items.filter(x => (x.minRealm ?? 0) > GOLD).length
}

/** 逐类内容的门槛清单;每条对照代码核实,不采信 UI 文案或设计文档 */
export const CONTENT_GATES: ContentGate[] = [
  {
    id: 'pet',
    name: '灵兽',
    kind: 'trigger',
    minMajor: 14,
    evidence:
      'PetDef 无境界字段;泛型事件(ev_wounded_beast / ft_beast_pledge)只发入门 8 只(凡/精/灵/玄/天,genericPetPool 按仙品档过滤);' +
      '6 只神兽(仙品/神品)由仙界及以上事件(id 指名、带 minRealm≥9)发放',
    reachableByGoldRebirth: false,
    bypass: '入门灵兽金丹前即可集齐;神兽须行至神界及以上,无绕过路径',
    qualifies: true
  },
  {
    id: 'mentor',
    name: '师承',
    kind: 'none',
    minMajor: 0,
    evidence: 'adoptMentor 仅判断「是否已拜」,mentorChoices 无条件返回全部 MENTORS',
    reachableByGoldRebirth: true,
    bypass: '第一世即可拜师,且 rebirth() 未重置 mentor,跨世保留',
    qualifies: false
  },
  {
    id: 'recipe',
    name: '丹方',
    kind: 'acquire',
    minMajor: 7,
    evidence: `PILLS 中 ${PILLS.filter(p => p.recipe).length} 个有方子,minRealm 分布至大乘;studiableRecipes 按 p.minRealm <= major 过滤`,
    reachableByGoldRebirth: false,
    bypass: 'STUDY_REACH_OVER 允许预支一阶,但 minRealm 是硬过滤,不可绕',
    qualifies: true
  },
  {
    id: 'gongfa',
    name: '功法',
    kind: 'acquire',
    minMajor: 7,
    evidence: `GONGFA ${GONGFA.length} 门,minRealm 分布至大乘;gongfaService 用 minRealm <= major + 1,可预支一境`,
    reachableByGoldRebirth: false,
    bypass: '可预支一境(金丹能学元婴功法),故实际门槛比标称低一档',
    qualifies: true
  },
  {
    id: 'region',
    name: '区域与敌手认知',
    kind: 'acquire',
    minMajor: 8,
    evidence: `REGIONS ${REGIONS.length} 个,金丹可进 ${REGIONS.filter(r => r.minRealm <= GOLD).length} 个,其余 ${beyondGold(REGIONS)} 个有更高 minRealm`,
    reachableByGoldRebirth: false,
    bypass: '无。区域是硬门槛,且敌手认知只能靠实战积累',
    qualifies: true
  },
  {
    id: 'event',
    name: '际遇事件',
    kind: 'trigger',
    minMajor: 3,
    evidence:
      `随机池 ${POOL_EVENTS.length} 个事件中 ${POOL_EVENTS.filter(e => e.minRealm !== undefined).length} 个带 minRealm` +
      `(入门 2 个 · 仙界及以上 7 个),其余无门槛;另有奇缘阶段不计入(不分地界)`,
    reachableByGoldRebirth: false,
    bypass: '绝大多数事件无门槛;仅问道石(元婴)真正需要深修',
    qualifies: false
  },
  {
    id: 'celestial',
    name: '天界与道痕',
    kind: 'acquire',
    minMajor: WORLD_BREAK_MAJOR,
    evidence: 'endgameUnlocked() 要求 major >= WORLD_BREAK_MAJOR(真仙,仙界门槛),无任何替代入口',
    reachableByGoldRebirth: false,
    bypass: '无',
    qualifies: true
  }
]

export interface ReachabilityRow {
  gate: ContentGate
  /** 金丹可达的条目占比(仅对可计数的内容有效) */
  goldShare: number | null
  /** 深修专属的条目数 */
  deepOnly: number | null
}

/** 可计数内容的金丹可达比例 */
export function reachabilityTable(): ReachabilityRow[] {
  const counts: Record<string, { total: number; gold: number }> = {
    recipe: {
      total: PILLS.filter(p => p.recipe).length,
      gold: PILLS.filter(p => p.recipe && p.minRealm <= GOLD).length
    },
    // 功法可预支一境
    gongfa: { total: GONGFA.length, gold: GONGFA.filter(g => g.minRealm <= GOLD + 1).length },
    region: { total: REGIONS.length, gold: REGIONS.filter(r => r.minRealm <= GOLD).length },
    // 入门灵兽(天品及以下)无门槛
    pet: { total: PETS.length, gold: PETS.filter(p => qualityDef(p.quality).rank <= 6).length },
    mentor: { total: MENTORS.length, gold: MENTORS.length },
    event: { total: POOL_EVENTS.length, gold: POOL_EVENTS.filter(e => (e.minRealm ?? 0) <= GOLD).length }
  }
  return CONTENT_GATES.map(gate => {
    const c = counts[gate.id]
    return {
      gate,
      goldShare: c ? c.gold / c.total : null,
      deepOnly: c ? c.total - c.gold : null
    }
  })
}

/** 有资格作深修独有回报的内容 */
export function qualifiedRewards(): ContentGate[] {
  return CONTENT_GATES.filter(g => g.qualifies)
}

/** 被证伪的候选:实际金丹就能拿全 */
export function disqualified(): ContentGate[] {
  return CONTENT_GATES.filter(g => !g.qualifies)
}
