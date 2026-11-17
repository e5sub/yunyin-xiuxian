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
  /*
   * 门派建筑**不设等级上限**(1.69.0):山门能一直往上垒,其余建筑的上限由山门抬
   * (见 SECT_BUILDING_GATE_MULT)。所以这里没有 maxLevel —— 一世的经营不该有「到顶」那一天。
   */
  /** 门派贡献基数(随等级增长,曲线见 core/sectRules 的 buildingCost) */
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

/**
 * 投师的境界门槛:筑基(major 1)。
 * 比开宗立派(元婴)低两个大境界 —— 前期玩家本来就没有开派的余力,
 * 让他们先入一家的门、借门中已有的技能树修行,才是「投他山门」这条路的意义。
 */
export const SECT_JOIN_MAJOR = 1
/** 一家门派同时挂着的待审申请上限:掌门一屏能审完,也挡「拿小号刷申请」 */
export const SECT_APPLY_MAX = 20
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
 * 门人是**真成员**(1.69.0 起):掌门一个、其余靠申请与审批进门,人数由 sect_members 实算;
 * 上限只在审批那一刻卡(满员即拒),不做「自动补足」。
 */
export const SECT_MEMBERS_BASE = 10
export const SECT_MEMBERS_PER_LEVEL = 1

/**
 * 职位名额(1.71.0):副掌门一位、长老四位,门人不限(名额随山门)。
 * 职位是「授权」不是「人上人」—— 副掌门与长老替掌门分担审批,副掌门还可逐人;
 * 任职与罢免只有掌门能做(见 core/sectRules 的 canKickSect / roleCap 与 /sect/role 路由)。
 */
export const SECT_DEPUTY_MAX = 1
export const SECT_ELDER_MAX = 4

/**
 * 营造队列:同时能在造几座。初始一位,山门每过 20 级(20/40/60/80)再开一位,百级至多五位。
 * 与技能上限同一思路:队列是山门给的,不是钱能买的 —— 想几座一起开工,先把山门垒上去。
 */
export const SECT_BUILD_QUEUE_STEP = 20
export const SECT_BUILD_QUEUE_STEPS = 4

/**
 * 门派建筑的等级**没有游戏上限**:山门能一直垒,门人的名额与其余建筑的余地也跟着一直开。
 * 999 只是「坏数硬夹」—— 存档里被写成 1e9 级时按它截断,别让面板与价目算到溢出。
 * 它不是天花板:按 core/sectRules 的曲线,50 级山门要三万多门派库,一百级已经是一年以上的事。
 */
export const SECT_LEVEL_HARD_MAX = 999

/** 山门定其余建筑等级上限的系数:上限 = (山门等级 + 1) × 2 */
export const SECT_BUILDING_GATE_MULT = 2
/**
 * 技能等级:**基础五重**。五重之后再往上,要看山门 —— 见下面的续修三常量。
 */
export const SECT_SKILL_MAX_LEVEL = 5
/**
 * 续修:山门每 20 级,技能的等级上限再开五重。
 * 20 / 40 / 60 / 80 / 100 级各一次,于是上限依次是 10 / 15 / 20 / 25 / 30 重。
 *
 * **为什么让山门定技能上限**:技能给的是永久属性,不能只凭个人贡献无限往上堆 ——
 * 那样一个人攒够贡献就能把一门练到盖过境界本身。把上限挂在山门上,
 * 「练得更高」与「全门一起垒山门」就成了同一件事,个人的贡献也有处可去。
 * 百级之后不再开(五档为限):再往上该走的是境界,不是门派。
 */
export const SECT_SKILL_CAP_HALL_STEP = 20
export const SECT_SKILL_CAP_STEP = 5
export const SECT_SKILL_CAP_STEPS = 5
/** 技能等级的硬上界:五重基础 + 五档续修 = 三十重(百级山门) */
export const SECT_SKILL_LEVEL_HARD_MAX = SECT_SKILL_MAX_LEVEL + SECT_SKILL_CAP_STEP * SECT_SKILL_CAP_STEPS
/**
 * 第 row 层技能的价目基数(个人贡献)。按「每日 3 捐」的口径标定:
 * 一次捐献 600 贡献 → 个人 420;一门五重共约 4,200~16,900 个人贡献,
 * 与建筑(山门 20 级约 35,000 门派库)同一量级,两边都不会先见底。
 */
export const SECT_SKILL_COST_BASE = [160, 240, 340, 480, 640] as const
/** 前五重的价目倍率:每重 ×1.9(陡涨,让「五重」本身就是一道坎) */
export const SECT_SKILL_COST_GROWTH = 1.9
/**
 * 五重之后的价目倍率:每重 ×1.15(缓涨)。
 *
 * **为什么续修要换一条斜率**:照 1.9 一路乘上去,第三十重会是第五重的 1.9^25 ≈ 930 万倍,
 * 单人日捐 420 贡献,一百年也点不到一重 —— 上限形同虚设。换成 1.15 之后,
 * 第五层一门从零到三十重约 206 万个人贡献(十人日捐 4,200,约 490 日),
 * 既够当长线经营,也不至于变成一句空话。
 *
 * 判据:`sectRules.spec` 的「续修逐重递增,第三十重仍在可承受的量级」。
 */
export const SECT_SKILL_COST_TAIL_GROWTH = 1.15

/**
 * 山门的双重照拂:山门每高一级,门中做事都省一分。
 *
 * 一、技能消耗的个人贡献 -0.5%/级(百级即 -50%,到此为止)。
 *    理由:山门是「传功」的地方 —— 藏经殿给突破、演武场给攻击,山门给的是
 *    「这一门的东西练起来更省」。封顶五成,是因为剩下那一半仍要个人自己掏:
 *    门派库与个人贡献是两条账,全免了等于技能不要钱。
 * 二、营造工期 -1%/级(百级即 -60%,到此为止,只剩四成)。
 *    理由:山门是营造的组织者。封顶六成同理 —— 高等级仍要等,只是不必等那么久。
 *
 * 判据:`sectRules.spec` 的「山门愈高,技能愈省、工期愈短,且各自封顶」。
 */
export const SECT_HALL_SKILL_CUT = 0.005
export const SECT_HALL_SKILL_CUT_MAX = 0.5
export const SECT_HALL_TIME_CUT = 0.01
export const SECT_HALL_TIME_CUT_MAX = 0.6

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
 * 五座建筑。山门是闸门:其余建筑的等级上限 = (山门等级 + 1) × 2 —— 山门不封顶,
 * 这份「余地」也就一直有得开;想升丹房,先垫山门。
 * 与洞府同一套「主闸」思路,但门派是多人共造,所以没有品类满级这一说(1.69.0)。
 */
export const SECT_BUILDINGS: SectBuildingDef[] = [
  {
    id: 'hall',
    name: '山门',
    desc: '门派根本。山门愈高,门人愈众,传功愈省,营造愈快',
    icon: 'mountain',
    costBase: 60,
    timeBaseMin: 6,
    effectText: lv =>
      `门人 ${SECT_MEMBERS_BASE + lv * SECT_MEMBERS_PER_LEVEL} 人;余筑上限 ${(lv + 1) * SECT_BUILDING_GATE_MULT} 级;`
      + `技能耗 -${Math.min(50, lv * 0.5)}% · 营造 -${Math.min(60, lv)}%;修炼 +${(lv * 1.5).toFixed(1)}%`,
    mods: lv => ({ cultivationSpeed: lv * 0.015 })
  },
  {
    id: 'scripture',
    name: '藏经殿',
    desc: '门中典籍所藏,传功解惑之地',
    icon: 'book',
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

export function sectBuildingDef(id: string): SectBuildingDef | undefined {
  return SECT_BUILDINGS.find(b => b.id === id)
}

/**
 * 门派绝学(1.74.1):每层一门、共五门,与三脉技能同层并排(每层凑齐四门)。
 * 与技能的分别:技能人人可修(个人贡献,等级堆叠),绝学是**全门共修**——
 * 有职者(掌门/副掌门/长老)出**门派库**一次性研究,研究成后全门同享加成,
 * 不分等级、不做个人。价目按「十人日捐」的口径标定,见各 costPool 注。
 */
export interface SectArtDef {
  id: string
  name: string
  desc: string
  /** 层次 1~5,与技能同层并排 */
  row: number
  /** 一重的门派库价;每升一重 ×1.9(见 core/sectRules 的 artCost) */
  costPool: number
  /** 每重加成;0 重即 0(与技能同形) */
  mods: (lv: number) => StatMods
  effectText: (lv: number) => string
}

export const SECT_ARTS: SectArtDef[] = [
  {
    id: 'art_guizong',
    name: '万法归宗',
    desc: '三脉之法同炉共冶,攻守兼资',
    row: 1,
    // 一重的门派库价;再往上每重 ×1.9(与技能同一条陡峭曲线,见 artCost)
    costPool: 3000,
    mods: lv => ({ damageBonus: lv * 0.012, damageReduction: lv * 0.008 }),
    effectText: lv => `伤害 +${(lv * 1.2).toFixed(1)}%,减伤 +${(lv * 0.8).toFixed(1)}%`
  },
  {
    id: 'art_xuangang',
    name: '百炼玄纲',
    desc: '合门之力炼就一条玄纲,锋锐破坚',
    row: 2,
    costPool: 8000,
    mods: lv => ({ armorPen: lv * 0.008, critRate: lv * 0.006 }),
    effectText: lv => `破甲 +${(lv * 0.8).toFixed(1)}%,暴击 +${(lv * 0.6).toFixed(1)}%`
  },
  {
    id: 'art_zhoutian',
    name: '周天吐纳',
    desc: '门中阵眼引气周天,修行事半功倍',
    row: 3,
    costPool: 16000,
    mods: lv => ({ cultivationSpeed: lv * 0.016, qiRegen: lv * 0.008 }),
    effectText: lv => `修速 +${(lv * 1.6).toFixed(1)}%,灵气恢复 +${(lv * 0.8).toFixed(1)}%`
  },
  {
    id: 'art_zaohua',
    name: '天工造化',
    desc: '聚宝阁藏天地造化之气,泽被门人',
    row: 4,
    costPool: 30000,
    mods: lv => ({ dropRate: lv * 0.012, doubleDropRate: lv * 0.008 }),
    effectText: lv => `装备掉落 +${(lv * 1.2).toFixed(1)}%,双倍战利 +${(lv * 0.8).toFixed(1)}%`
  },
  {
    id: 'art_zhenpai',
    name: '镇派大阵',
    desc: '开山祖师留下的护门大阵,全门同沐其威',
    row: 5,
    costPool: 50000,
    mods: lv => ({ attackPct: lv * 0.012, maxHpPct: lv * 0.012, firstStrike: lv * 0.02 }),
    effectText: lv => `攻击 +${(lv * 1.2).toFixed(1)}%,生命上限 +${(lv * 1.2).toFixed(1)}%,首回合伤害 +${(lv * 2).toFixed(0)}%`
  }
]

/** 绝学的重数上限:每门五重(与技能的基础五重同量级;续修不开,这是门派的底蕴) */
export const SECT_ART_MAX_LEVEL = 5

/** 按绝学 id 反查 */
export function sectArtDef(id: string): SectArtDef | undefined {
  return SECT_ARTS.find(a => a.id === id)
}

/**
 * 三脉十五门技能,按层排:每层三脉各一门。
 * 门派**不分道统**(1.69.0):开宗立派只取名,门中三脉之法皆可修习 ——
 * 太虚的剑、丹霞的丹、万象的阵同藏一门,想走哪条路由自己挑(等级归个人,换门随行)。
 */
export const SECT_SKILLS: SectSkillDef[] = SECTS.flatMap(s => s.skills).sort((a, b) => a.row - b.row)

/** 某门技能出自哪一脉(界面上标一行小字);认不出 → undefined */
export function sectOfSkill(skillId: string): SectDef | undefined {
  return SECTS.find(s => s.skills.some(k => k.id === skillId))
}

/** 按技能 id 反查(跨宗门也认得出,便于台账与提示) */
export function sectSkillDef(skillId: string): SectSkillDef | undefined {
  return SECT_SKILLS.find(s => s.id === skillId)
}
