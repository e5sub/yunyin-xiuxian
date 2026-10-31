/**
 * 数值体系说明 —— 单一事实源:数字一律取自 constants,不手写;spec 钉:progressionDoc.spec。
 *
 * 三条口径:
 *   1. 每个大境界的数值按复利增长(修为需求 / 灵气容量 / 灵气回复 / 战力)
 *   2. 每个大境界的净耗时增长慢于数值
 *   3. 修为与灵气可积余:卡境时继续累积,越过需求的部分带走
 */
import {
  BUILDING_COST_GROWTH,
  COMBAT_MAJOR_GROWTH,
  CULT_MAJOR_SPEED_GROWTH,
  DIVINATION_COST,
  EXP_MAJOR_GROWTH,
  GONGFA_UP_GROWTH,
  LATE_COMBAT_GROWTH,
  LATE_CULT_SPEED_GROWTH,
  LATE_EXP_GROWTH,
  LATE_QI_CAP_GROWTH,
  LATE_QI_REGEN_GROWTH,
  MANSION_EVENT_LUCK,
  QI_BANK_MULT,
  QI_CAP_MAJOR_GROWTH,
  QI_REGEN_MAJOR_GROWTH,
  STONE_TIER_GROWTH,
  TRIBULATION_DIFFICULTY_CAP_MAJOR,
  UPGRADE_DUST_GROWTH
} from './constants'
import { LIFESPAN_WORLDS, REALMS, WORLDS, WORLD_BREAK_MAJOR } from './realms'
import { PALACES, STARS } from './ziwei'
import { GATES } from './qimen'
import { MANSIONS, IMAGES } from './xiangxiu'
import { TRIGRAMS, HEXAGRAMS, CHANGING_TIERS } from './yijing'
import { cnNumber } from '@/utils/format'

export interface ProgressionAxis {
  id: string
  name: string
  /** 人间界每境倍率 */
  mortal: number
  /** 界外每境倍率 */
  outer: number
  note: string
}

/** 各数值轴的每境复利倍率 */
export const PROGRESSION_AXES: ProgressionAxis[] = [
  {
    id: 'exp',
    name: '修为需求',
    mortal: EXP_MAJOR_GROWTH,
    outer: LATE_EXP_GROWTH,
    note: '突破所需修为'
  },
  {
    id: 'qiCap',
    name: '灵气容量',
    mortal: QI_CAP_MAJOR_GROWTH,
    outer: LATE_QI_CAP_GROWTH,
    note: '标称容量'
  },
  {
    id: 'qiRegen',
    name: '灵气回复',
    mortal: QI_REGEN_MAJOR_GROWTH,
    outer: LATE_QI_REGEN_GROWTH,
    note: '增速略慢于容量'
  },
  {
    id: 'attack',
    name: '战力(攻击/防御/生命)',
    mortal: COMBAT_MAJOR_GROWTH,
    outer: LATE_COMBAT_GROWTH,
    note: '与同期内容同速成长'
  }
]

/** 每大境净耗时倍率 */
export const MORTAL_TIME_PER_MAJOR = EXP_MAJOR_GROWTH / CULT_MAJOR_SPEED_GROWTH
export const OUTER_TIME_PER_MAJOR = LATE_EXP_GROWTH / LATE_CULT_SPEED_GROWTH

export interface CostCurve {
  id: string
  name: string
  /** 每单位(级 / 层)倍率 */
  growth: number
  unit: '等级' | '层级'
  note: string
}

/** 各处花费的复利倍率 */
export const COST_CURVES: CostCurve[] = [
  { id: 'building', name: '洞府建筑升级', growth: BUILDING_COST_GROWTH, unit: '等级', note: '灵石开销' },
  { id: 'gongfa', name: '功法参悟', growth: GONGFA_UP_GROWTH, unit: '等级', note: '悟道点开销' },
  { id: 'equipLevel', name: '装备强化', growth: UPGRADE_DUST_GROWTH, unit: '等级', note: '器灵尘开销;灵石按层级另计' },
  { id: 'stoneTier', name: '灵石掉落', growth: STONE_TIER_GROWTH, unit: '层级', note: '每层地界灵石产出' }
]

export interface LifespanCurve {
  world: string
  /** 该界域起点的寿元 */
  base: number
  /** 界域内每境倍率 */
  growth: number
}

/** 寿元曲线:界域内复利,跨界为大跃 */
export const LIFESPAN_CURVES: LifespanCurve[] = WORLDS.map(w => ({
  world: w.name,
  base: LIFESPAN_WORLDS[w.id].base,
  growth: LIFESPAN_WORLDS[w.id].growth
}))

/** 供界面展示的固定说明 */
export const PROGRESSION_NOTES = {
  worldBreakMajor: WORLD_BREAK_MAJOR,
  tribulationCapMajor: TRIBULATION_DIFFICULTY_CAP_MAJOR,
  banking: [
    '修为不封顶:卡境时照常增长',
    '突破只扣当境需求,积余带入下一境',
    `灵气可积到标称容量的 ${QI_BANK_MULT} 倍;负伤时可耗灵气疗伤`
  ],
  basis: [
    '人间界九境取内丹术与佛道之序:炼气、筑基、金丹、元婴、化神、炼虚、合体、大乘、渡劫',
    '仙界五境取道教仙阶:真仙、玄仙、金仙、太乙、大罗',
    '神界四境取网文常用神阶:神人、神将、神王、神帝',
    '混沌海三境取道家宇宙论:混沌真灵、混沌神魔、混沌道祖',
    '本源八境取道家宇宙论:混元、无极、太极、太素、太始、太初、鸿蒙、道源'
  ],
  breakthrough: [
    '小进阶成功率不随境界无限下降',
    `大关须渡天劫:成败看劫型与护持/续航/抗性/爆发,天劫难度在「${
      REALMS[WORLD_BREAK_MAJOR]!.name
    }」处封顶`,
    '真仙、神人、混沌真灵三个跨界入口同样须渡天劫',
    '突破失败损失部分修为(「护道」类词条可减免),积余不失'
  ]
}

/** 术数四门:四层时机各占一层,不是四份叠加的加成;节奏与代价的数字取自各自模块 */
export interface SorceryLayer {
  id: 'gong' | 'ming' | 'xiang' | 'men'
  name: string
  /** 节奏:多快轮换一次 */
  cadence: string
  cost: string
  /** 管什么 */
  note: string
}

export const SORCERY_LAYERS: SorceryLayer[] = [
  {
    id: 'gong',
    name: '周易 · 问卦',
    cadence: `卦管 ${CHANGING_TIERS[0]!.minutes}~${CHANGING_TIERS[CHANGING_TIERS.length - 1]!.minutes} 分钟`,
    cost: `悟道点 ${DIVINATION_COST} · 一事不二卜`,
    note: `${TRIGRAMS.length} 卦为体、${HEXAGRAMS.length} 卦为用;动爻越多,卦力越盛、时限越短`
  },
  {
    id: 'ming',
    name: '紫微 · 命格',
    cadence: '一世常驻',
    cost: '免费 · 转世重排',
    note: `${PALACES.length} 宫 ${STARS.length} 主星;力薄、无时限,不与卦叠加同类效果`
  },
  {
    id: 'xiang',
    name: '星象 · 值日',
    cadence: `${MANSIONS.length} 日一轮 · ${IMAGES.length} 象配四界`,
    cost: '免费、被动',
    note: `仅所配界域:际遇 +${Math.round(MANSION_EVENT_LUCK * 100)}%`
  },
  {
    id: 'men',
    name: '奇门 · 择门',
    cadence: '一趟远征一择',
    cost: '免费',
    note: `${GATES.length} 门各有打法(续航/抢攻/守拙/速决);不改道源倍数`
  }
]

/**
 * 术数四门的分工一句话(展示用)。层数从 `SORCERY_LAYERS` 现算,不写死;
 * 天气(`core/weather`)并入 `finalStats.mods`,不属术数分层,不计入。
 */
export const SORCERY_SUMMARY = `问卦、命格、值日、择门,${cnNumber(SORCERY_LAYERS.length)}层各占一层,互不顶替`
