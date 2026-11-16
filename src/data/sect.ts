/** 门派数据 —— 3 宗门 · 15 门技能 · 5 座建筑 · 3 档捐献 */
import type { StatMods } from '@/types'

/**
 * 门派是「云端的账」,不进存档分片(见 core/sectRules 头注与 server/src/sectState.ts)。
 * 这里只放静态数据:宗门、技能树、建筑、捐献档位。
 */

export type SectId = 'taixu' | 'danxia' | 'wanxiang'
export type SectBuildingId = 'hall' | 'scripture' | 'arena' | 'alchemy' | 'treasury'
export type SectDonateKind = 'stone' | 'ore' | 'herb'

export interface SectSkillDef {
  id: string
  name: string
  desc: string
  /** 层次 1~5:同层解锁须上一层到 2 级(见 sectRules 的 skillUnlockNeed) */
  row: number
  /** 每级加成;0 级即 0 */
  mods: (lv: number) => StatMods
  effectText: (lv: number) => string
}

export interface SectDef {
  id: SectId
  name: string
  /** 一句宗旨(界面副标题) */
  motto: string
  desc: string
  icon: string
  skills: SectSkillDef[]
}

export interface SectBuildingDef {
  id: SectBuildingId
  name: string
  desc: string
  icon: string
  maxLevel: number
  /** 门派贡献基数(随等级指数增长) */
  costBase: number
  /** 升一级的基础耗时(分钟,随等级增长) */
  timeBaseMin: number
  effectText: (lv: number) => string
  mods: (lv: number) => StatMods
}

export interface SectDonationDef {
  kind: SectDonateKind
  name: string
  desc: string
  icon: string
  /** 交给门派的实物份数:灵石/玄铁/灵草 */
  amount: number
  /** 换得的门派贡献总量(其中三成入门派库,见 SECT_POOL_SHARE) */
  contribution: number
}

/**
 * 开宗立派的门槛:元婴境(major 3)。
 * 金丹期正被灵脉与结丹开销占满,再压一笔建派钱会把主线挤断;元婴起手有余力,
 * 且此时门派技能与建筑的加成才不会过早稀释前期难度。
 */
export const SECT_FOUND_MAJOR = 3
/** 建派的一次性开销(服务端复算并记 sect_spend 台账,客户端只作预览) */
export const SECT_FOUND_COST = { stone: 60_000, ore: 300, wudao: 2_000 } as const
/** 门派名长度:二字至七字(留出「太虚剑宗」这类四字与「XX 门」这类短名) */
export const SECT_NAME_MIN = 2
export const SECT_NAME_MAX = 7

/** 捐献里进入「门派库」的比例:其余记为个人贡献 */
export const SECT_POOL_SHARE = 0.3
/**
 * 每日捐献次数:常驻 3 次,VIP 5 次。次数是「日课」而非「刷子」——
 * 一次捐 2000 灵石换 600 贡献,3 次即 1800 贡献,够升一两级山门。
 * 服务端按 UTC+8 日界计,客户端的计数只作显示。VIP 的贡献开销另按九折(core/sectRules 的 rate)。
 */
export const SECT_DONATE_DAILY_CAP = 3
export const SECT_DONATE_VIP_CAP = 5

/**
 * 门人:山门定人数上限 —— 初始 10 人,山门每升一级 +1 人。
 * 这是**容量**(门人自动补足到上限),不改数值;面板上按「门人 N / N」显示,
 * 让山门除了当闸门之外还有一层看得见的经营感。
 */
export const SECT_MEMBERS_BASE = 10
export const SECT_MEMBERS_PER_LEVEL = 1

/** 山门定其余建筑等级上限的系数:上限 = (山门等级 + 1) × 2 */
export const SECT_BUILDING_GATE_MULT = 2
/** 技能等级上限:每门五重 */
export const SECT_SKILL_MAX_LEVEL = 5
/**
 * 第 row 层技能的价目基数(个人贡献)。按「每日 3 捐」的口径标定:
 * 一次捐献 600 贡献 → 个人 420;满门五重共约 49,000 个人贡献 ≈ 117 次捐献,
 * 与建筑(约 30,000 门派库 ≈ 168 次捐献)同一量级,两边都不会先见底。
 */
export const SECT_SKILL_COST_BASE = [160, 240, 340, 480, 640] as const
/** 每级价目倍率 */
export const SECT_SKILL_COST_GROWTH = 1.9

export const SECTS: SectDef[] = [
  {
    id: 'taixu',
    name: '太虚剑宗',
    motto: '一剑破万法',
    desc: '以剑证道,重攻伐。同门皆习剑意,进境愈深,锋锐愈盛',
    icon: 'sword',
    skills: [
      {
        id: 'taixu_sword',
        name: '太虚剑意',
        desc: '起手式。以意御剑,攻伐自增',
        row: 1,
        mods: lv => ({ attackPct: lv * 0.02 }),
        effectText: lv => `攻击 +${(lv * 2).toFixed(0)}%`
      },
      {
        id: 'taixu_break',
        name: '破锋诀',
        desc: '剑走偏锋,专破护体罡气',
        row: 2,
        mods: lv => ({ armorPen: lv * 0.015, critDamage: lv * 0.03 }),
        effectText: lv => `破甲 +${(lv * 1.5).toFixed(1)}%,暴伤 +${(lv * 3).toFixed(0)}%`
      },
      {
        id: 'taixu_flow',
        name: '流云身法',
        desc: '身随剑走,来去如云',
        row: 3,
        mods: lv => ({ speed: lv * 0.02, dodgeRate: lv * 0.01 }),
        effectText: lv => `身法 +${(lv * 2).toFixed(0)}%,闪避 +${(lv).toFixed(0)}%`
      },
      {
        id: 'taixu_kill',
        name: '斩魄',
        desc: '一剑落处,残血者无所遁形',
        row: 4,
        mods: lv => ({ executeDamage: lv * 0.04, damageBonus: lv * 0.015 }),
        effectText: lv => `斩杀 +${(lv * 4).toFixed(0)}%,伤害 +${(lv * 1.5).toFixed(1)}%`
      },
      {
        id: 'taixu_heart',
        name: '剑心通明',
        desc: '心中无尘,剑上无滞',
        row: 5,
        mods: lv => ({ attackPct: lv * 0.03, critRate: lv * 0.01 }),
        effectText: lv => `攻击 +${(lv * 3).toFixed(0)}%,暴击 +${lv.toFixed(0)}%`
      }
    ]
  },
  {
    id: 'danxia',
    name: '丹霞谷',
    motto: '一炉照长生',
    desc: '以丹养道,重久长。同门善调药火,亦知驻世之法',
    icon: 'flask',
    skills: [
      {
        id: 'danxia_fire',
        name: '文武火',
        desc: '火候既明,丹成自多',
        row: 1,
        mods: lv => ({ alchemyYield: lv * 0.04 }),
        effectText: lv => `成丹 +${(lv * 4).toFixed(0)}%`
      },
      {
        id: 'danxia_qi',
        name: '引气归元',
        desc: '以药引气,气归丹田',
        row: 2,
        mods: lv => ({ qiRegen: lv * 0.04, cultivationSpeed: lv * 0.02 }),
        effectText: lv => `回气 +${(lv * 4).toFixed(0)}%,修炼 +${(lv * 2).toFixed(0)}%`
      },
      {
        id: 'danxia_long',
        name: '驻颜长生',
        desc: '服食有节,形神不衰',
        row: 3,
        mods: lv => ({ lifespanPct: lv * 0.02 }),
        effectText: lv => `寿元 +${(lv * 2).toFixed(0)}%`
      },
      {
        id: 'danxia_poison',
        name: '百毒不侵',
        desc: '以毒试身,反成护体',
        row: 4,
        mods: lv => ({ damageReduction: lv * 0.015, tribulationResist: lv * 0.02 }),
        effectText: lv => `减伤 +${(lv * 1.5).toFixed(1)}%,渡劫抗 +${(lv * 2).toFixed(0)}%`
      },
      {
        id: 'danxia_gold',
        name: '金丹大道',
        desc: '一粒金丹吞入腹,我命由我不由天',
        row: 5,
        mods: lv => ({ maxHpPct: lv * 0.02, cultivationSpeed: lv * 0.03 }),
        effectText: lv => `气血 +${(lv * 2).toFixed(0)}%,修炼 +${(lv * 3).toFixed(0)}%`
      }
    ]
  },
  {
    id: 'wanxiang',
    name: '万象阵宗',
    motto: '一图镇山河',
    desc: '以阵御敌,重守御。同门布阵成势,以静制动',
    icon: 'orbit',
    skills: [
      {
        id: 'wanxiang_array',
        name: '基础阵理',
        desc: '九宫八卦,先立其形',
        row: 1,
        mods: lv => ({ defensePct: lv * 0.02 }),
        effectText: lv => `防御 +${(lv * 2).toFixed(0)}%`
      },
      {
        id: 'wanxiang_qi',
        name: '聚灵阵眼',
        desc: '阵眼聚灵,气自盈门',
        row: 2,
        mods: lv => ({ qiCapPct: lv * 0.03, qiRegen: lv * 0.02 }),
        effectText: lv => `灵气上限 +${(lv * 3).toFixed(0)}%,回气 +${(lv * 2).toFixed(0)}%`
      },
      {
        id: 'wanxiang_lock',
        name: '困阵',
        desc: '入我阵中,动辄受制',
        row: 3,
        mods: lv => ({ stunRate: lv * 0.015, counterRate: lv * 0.02 }),
        effectText: lv => `定身 +${(lv * 1.5).toFixed(1)}%,反击 +${(lv * 2).toFixed(0)}%`
      },
      {
        id: 'wanxiang_ward',
        name: '护山阵',
        desc: '阵起如城,攻者自疲',
        row: 4,
        mods: lv => ({ shieldOnStart: lv * 0.02, damageReduction: lv * 0.01 }),
        effectText: lv => `护盾 +${(lv * 2).toFixed(0)}%,减伤 +${(lv).toFixed(0)}%`
      },
      {
        id: 'wanxiang_all',
        name: '万象归一',
        desc: '万阵归于一念,山河即在掌中',
        row: 5,
        mods: lv => ({ defensePct: lv * 0.03, maxHpPct: lv * 0.015 }),
        effectText: lv => `防御 +${(lv * 3).toFixed(0)}%,气血 +${(lv * 1.5).toFixed(1)}%`
      }
    ]
  }
]

/**
 * 五座建筑。山门是闸门:其余建筑的等级上限 = (山门等级 + 1) × 2,满 10 级须先把山门升到 4。
 * 与洞府同一套「主闸」思路,但闸门更紧 —— 门派是一世一建,不该一上来就把演武场拉满。
 */
export const SECT_BUILDINGS: SectBuildingDef[] = [
  {
    id: 'hall',
    name: '山门',
    desc: '门派根本。山门愈高,其余营造的余地愈大',
    icon: 'mountain',
    maxLevel: 8,
    costBase: 60,
    timeBaseMin: 6,
    effectText: lv =>
      `门人 ${SECT_MEMBERS_BASE + lv * SECT_MEMBERS_PER_LEVEL} 人;其余建筑上限 ${Math.min(10, (lv + 1) * SECT_BUILDING_GATE_MULT)} 级;修炼 +${(lv * 1.5).toFixed(1)}%`,
    mods: lv => ({ cultivationSpeed: lv * 0.015 })
  },
  {
    id: 'scripture',
    name: '藏经殿',
    desc: '门中典籍所藏,传功解惑之地',
    icon: 'book',
    maxLevel: 10,
    costBase: 40,
    timeBaseMin: 5,
    effectText: lv => `突破成功率 +${lv.toFixed(0)}%`,
    mods: lv => ({ breakthroughRate: lv * 0.01 })
  },
  {
    id: 'arena',
    name: '演武场',
    desc: '同门切磋之所,日日不辍',
    icon: 'swords',
    maxLevel: 10,
    costBase: 40,
    timeBaseMin: 5,
    effectText: lv => `攻击 +${(lv * 1.2).toFixed(1)}%`,
    mods: lv => ({ attackPct: lv * 0.012 })
  },
  {
    id: 'alchemy',
    name: '丹房',
    desc: '合药之所,炉火常年不熄',
    icon: 'flame',
    maxLevel: 10,
    costBase: 40,
    timeBaseMin: 5,
    effectText: lv => `成丹 +${(lv * 3).toFixed(0)}%`,
    mods: lv => ({ alchemyYield: lv * 0.03 })
  },
  {
    id: 'treasury',
    name: '聚宝阁',
    desc: '门中产业所出,皆聚于此',
    icon: 'gem',
    maxLevel: 10,
    costBase: 48,
    timeBaseMin: 6,
    effectText: lv => `灵石所得 +${(lv * 2).toFixed(0)}%,机缘 +${(lv * 0.5).toFixed(1)}%`,
    mods: lv => ({ spiritStoneGain: lv * 0.02, luck: lv * 0.005 })
  }
]

/** 三档捐献:份数固定,贡献固定(份数按境界产出量级取的整数,便于一眼记) */
export const SECT_DONATIONS: SectDonationDef[] = [
  {
    kind: 'stone',
    name: '捐灵石',
    desc: '以灵石充门中用度',
    icon: 'gem',
    amount: 2000,
    contribution: 600
  },
  {
    kind: 'ore',
    name: '捐玄铁',
    desc: '玄铁入炉,可铸兵刃法器',
    icon: 'axe',
    amount: 20,
    contribution: 600
  },
  {
    kind: 'herb',
    name: '捐灵草',
    desc: '灵草入药,供丹房取用',
    icon: 'leaf',
    amount: 12,
    contribution: 540
  }
]

export function sectDef(id: string): SectDef | undefined {
  return SECTS.find(s => s.id === id)
}

export function sectBuildingDef(id: string): SectBuildingDef | undefined {
  return SECT_BUILDINGS.find(b => b.id === id)
}

/** 某宗门的技能;技能 id 全局唯一,认不出宗门时回空表 */
export function sectSkillsOf(id: string): SectSkillDef[] {
  return sectDef(id)?.skills ?? []
}

/** 按技能 id 反查(跨宗门也认得出,便于台账与提示) */
export function sectSkillDef(skillId: string): SectSkillDef | undefined {
  for (const sect of SECTS) {
    const hit = sect.skills.find(s => s.id === skillId)
    if (hit !== undefined) return hit
  }
  return undefined
}
