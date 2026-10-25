/**
 * 轮回阶段:按宿慧(前世所知所历)分阶,不按轮回次数。
 * 各阶只开信息与知识层能力,不加属性;属性收益走道果与天赋(见 core/formulas.ts)。
 */

/** 一阶轮回所开的见识 */
export interface SamsaraStageDef {
  /** 阶序 0 起 */
  index: number
  id: string
  name: string
  /** 这一阶的处境(玩家可见) */
  desc: string
  /** 踏入此阶所需宿慧 */
  insight: number
  /** 转世即认得的灵材阶位上限(0 表示一概不识) */
  knownMaterialRank: number
  /** 战前看得见敌人机制(交手过的敌人,认知层门槛下调一档) */
  enemyInsight: boolean
  /** 天数可窥:天劫与终局规则的细节提前可见 */
  heavenInsight: boolean
  /** 命题自选:从全部已开命题里挑(否则抽三取一) */
  themeFreeChoice: boolean
  /** 转世时可留一门功法层数不折半 */
  keepOneGongfa: boolean
}

function s(
  index: number,
  id: string,
  name: string,
  insight: number,
  desc: string,
  caps: Partial<Omit<SamsaraStageDef, 'index' | 'id' | 'name' | 'insight' | 'desc'>>
): SamsaraStageDef {
  return {
    index,
    id,
    name,
    desc,
    insight,
    knownMaterialRank: caps.knownMaterialRank ?? 0,
    enemyInsight: caps.enemyInsight ?? false,
    heavenInsight: caps.heavenInsight ?? false,
    themeFreeChoice: caps.themeFreeChoice ?? false,
    keepOneGongfa: caps.keepOneGongfa ?? false
  }
}

export const SAMSARA_STAGES: SamsaraStageDef[] = [
  s(0, 'st_first', '初入轮回', 0, '前尘尽散,你只带着一具新的皮囊和一片空白。所见皆是初见。', {}),
  s(1, 'st_mortal', '熟知凡间', 90, '凡间的草木你已叫得出名字。田埂上那株青芝,你上一世采过。', {
    knownMaterialRank: 2
  }),
  s(2, 'st_xiuxian', '熟知修仙界', 260, '哪片林子里的东西会绕后,哪头妖物残血才发狂——你交过手,你记得。', {
    knownMaterialRank: 4,
    enemyInsight: true
  }),
  s(3, 'st_heaven', '熟知天界', 600, '天劫落下前的那点征兆,你辨得出来。道途的规矩,你也见过几轮了。', {
    knownMaterialRank: 6,
    enemyInsight: true,
    heavenInsight: true
  }),
  s(4, 'st_ancient', '百世老修', 1100, '你已不是"重新开始的人",而是带着百世记忆重新投胎的存在。这一世要做什么,由你自己定。', {
    knownMaterialRank: 9,
    enemyInsight: true,
    heavenInsight: true,
    themeFreeChoice: true,
    keepOneGongfa: true
  })
]

/** 宿慧折算到该阶(取不超过宿慧的最高一阶) */
export function stageAt(insight: number): SamsaraStageDef {
  let out = SAMSARA_STAGES[0]!
  for (const st of SAMSARA_STAGES) {
    if (insight >= st.insight) out = st
  }
  return out
}

/** 下一阶(已在顶阶时返回 null) */
export function nextStageAfter(insight: number): SamsaraStageDef | null {
  return SAMSARA_STAGES.find(st => st.insight > insight) ?? null
}

// ============ 这一世的存根 ============

/** 本世立下的命题;判定取计数器与开世快照的差值(见 core/samsaraService.ts) */
export interface LifeVow {
  /** 命题 id(见 data/lifeThemes.ts) */
  themeId: string
  /** 开世时刻 */
  at: number
  /** 开世时跨世累计计数器的快照 */
  base: Partial<Record<import('@/types').CounterKey, number>>
  /** 开世时已择定的悟道分支数 */
  baseBranches: number
  /** 开世时已雪耻的宿敌数 */
  baseAvenged: number
  /** 已犯忌讳(破题);破题不扣任何东西 */
  broken: boolean
}

/** 一世的履历:转世时归档,即「修行画像」里的过往 */
export interface LifeRecord {
  /** 第几世(1 起) */
  index: number
  /** 终点大境界 */
  major: number
  /** 终点境界名 */
  realmLabel: string
  /** 终寿 */
  age: number
  /** 本世立的题;未立题为 null */
  themeId: string | null
  /** 命题结局 */
  themeResult: 'done' | 'unfinished' | 'broken' | null
  /** 本世所得宿慧 */
  insight: number
  /** 本世签下的逆旅契;未签为 null(老存档无此字段) */
  trialId?: string | null
  /** 本世的关系结局;未遇见任何人为 null */
  bond?: { name: string; stage: string; ending: string } | null
  /** 归档时刻 */
  at: number
}

// ============ 宿慧的构成 ============
// 每一项都对应实际做过的事,没有一项靠挂机自然增长。

/** 一世阅历 = (终点大境界 + 1) × 此系数 */
export const INSIGHT_PER_LIFE_REALM = 2
/** 认得一味灵材(认知层 ≥1) */
export const INSIGHT_PER_MATERIAL = 3
/** 通晓一味灵材的用法(认知层 = 3),在认得的基础上再计 */
export const INSIGHT_PER_MATERIAL_MASTERED = 5
/** 通晓一张丹方(掌握度 = 1) */
export const INSIGHT_PER_RECIPE = 4
/** 九项技艺熟练度之和(0~900)除以此数计入 */
export const INSIGHT_SKILL_DIV = 20
/** 洞悉一种敌人(敌人认知层 = 3) */
export const INSIGHT_PER_ENEMY = 2

/** 旧存档折算:每一次已有的转世按此计阅历;取值使转世十次的老档至少落在「熟知凡间」 */
export const INSIGHT_LEGACY_PER_LIFE = 14

/** 旧存档折算:转世次数换算成的宿慧(迁移与显示共用,见 stores/player.ts 的 sanitize) */
export function legacyInsightOf(count: number): number {
  return Math.max(0, count) * INSIGHT_LEGACY_PER_LIFE
}

/**
 * 多少宿慧折一点灵根资质地板;与次数口径(转世次数 × 5)取较大值,见 core/samsaraService.ts 的 aptitudeFloorNow。
 * 次数口径不封顶:资质本就硬封顶 100(见 core/linggenGen.ts)。
 */
export const INSIGHT_PER_APTITUDE = 12
