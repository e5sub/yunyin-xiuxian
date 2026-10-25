/**
 * 收窄方案影响面审计(只度量,不改数值)。收窄决议:宿慧、灵脉、先天之姿移出浅轮回,只留道果、灵兽、成就图鉴、基础认知。
 * 三条主线:宿慧的来源与消费者性质;灵脉存量按历史遗产还是本世建设;先天之姿与灵脉同构。断言跑在真实存档探针上。
 */
import {
  INSIGHT_PER_APTITUDE,
  INSIGHT_PER_LIFE_REALM,
  SAMSARA_STAGES,
  legacyInsightOf,
  stageAt
} from '@/data/samsara'
import { REINCARNATE_APTITUDE_FLOOR, VEIN_MAIN_CAPACITY, VEIN_SIDE_CAP, VEIN_TOTAL_CAPACITY } from '@/data/constants'
import { TALENTS } from '@/data/talents'
import { MANUAL_REBIRTH_MIN_MAJOR } from './reincarnation'

// ============ 一、宿慧的来源 ============

/** 宿慧两本账:`stock` 存量落存档,由 addInsight 累加;`live` 现量由当下认知实时折算,不存盘 */
export type InsightSource = 'stock' | 'live'

export interface InsightChannel {
  id: string
  name: string
  source: InsightSource
  /** 金丹一世的产出(现量按认知规模计,不适用则为 null) */
  perGoldLife: number | null
  persisted: boolean
  /** 高阶部分是否受境界硬挡 */
  realmGated: boolean
  evidence: string
}

export const INSIGHT_CHANNELS: InsightChannel[] = [
  {
    id: 'lifeRealm',
    name: '历世阅历',
    source: 'stock',
    perGoldLife: (MANUAL_REBIRTH_MIN_MAJOR + 1) * INSIGHT_PER_LIFE_REALM,
    persisted: true,
    realmGated: false,
    evidence: `lifeInsight(major) = (major+1)×${INSIGHT_PER_LIFE_REALM};金丹世每次 +${(MANUAL_REBIRTH_MIN_MAJOR + 1) * INSIGHT_PER_LIFE_REALM},无上限`
  },
  {
    id: 'theme',
    name: '命题达成',
    source: 'stock',
    perGoldLife: null,
    persisted: true,
    realmGated: false,
    evidence: '走到底的命题给 def.insight;未竟与破题不给也不扣。走完的题不再出现,故总量有界'
  },
  {
    id: 'lore',
    name: '认知折算',
    source: 'live',
    perGoldLife: null,
    persisted: false,
    realmGated: true,
    evidence: 'loreInsight(材料/丹方/技艺/敌手)实时折算;高阶丹方与材料受 minRealm 硬挡,深修才够得着'
  }
]

// ============ 二、宿慧的消费者 ============

/** 消费者性质:`opening` 只影响转世起点,本世可追平;`standing` 阶位在即全程有效、追不平,只有它算永久继承资产 */
export type ConsumerKind = 'opening' | 'standing'

export interface InsightConsumer {
  id: string
  name: string
  kind: ConsumerKind
  /** 经由哪个阶位字段生效 */
  via: string
  /** 最低生效阶序 */
  fromStage: number
  evidence: string
}

export const INSIGHT_CONSUMERS: InsightConsumer[] = [
  {
    id: 'carryLore',
    name: '睁眼即认得灵材',
    kind: 'opening',
    via: 'knownMaterialRank',
    fromStage: 1,
    evidence: 'carryLore 走 advanceLore(id, 1),是**补足**不是保留;认知本就不因转世清零,本世采药照样能认全'
  },
  {
    id: 'keepGongfa',
    name: '留一门功法不折半',
    kind: 'opening',
    via: 'keepOneGongfa',
    fromStage: 4,
    evidence: 'carryGongfa 只在转世那一刻决定层数;本世重练即可追回,且仅顶阶「百世老修」才有'
  },
  {
    id: 'enemyInsight',
    name: '战前看得见敌人机制',
    kind: 'standing',
    via: 'enemyInsight',
    fromStage: 2,
    evidence: '认知层门槛下调一档,这一世每一场战斗都在生效,无法靠本世行为补上'
  },
  {
    id: 'heavenInsight',
    name: '天数可窥',
    kind: 'standing',
    via: 'heavenInsight',
    fromStage: 3,
    evidence: '天劫与终局规则细节提前可见,全程有效'
  },
  {
    id: 'themeFree',
    name: '命题自选',
    kind: 'standing',
    via: 'themeFreeChoice',
    fromStage: 4,
    evidence: '抽三取一变成全池自选,直接决定每一世能立什么题'
  },
  {
    id: 'aptitudeFloor',
    name: '灵根资质地板',
    kind: 'standing',
    via: 'aptitudeFloorNow',
    fromStage: 0,
    evidence: `不走阶位,直接吃 totalInsight/${INSIGHT_PER_APTITUDE};但与「次数×${REINCARNATE_APTITUDE_FLOOR}」取较大者`
  }
]

export function standingConsumers(): InsightConsumer[] {
  return INSIGHT_CONSUMERS.filter(c => c.kind === 'standing')
}

export function openingConsumers(): InsightConsumer[] {
  return INSIGHT_CONSUMERS.filter(c => c.kind === 'opening')
}

// ============ 三、真实存档探针 ============

/** 两份真实存档的实测值(只取统计量,不含任何个人数据) */
export interface SaveProbe {
  name: string
  rebirths: number
  /** 存档里 reincarnation.insight 字段的原值;undefined 表示字段不存在 */
  insightField: number | undefined
  /** 读档 sanitize 之后实际拿到的存量 */
  stockAfterLoad: number
  /** 由认知折算出的现量 */
  live: number
  /** 灵脉四条脉的投点 */
  veins: Readonly<Record<string, number>>
  /** 已得先天之姿 */
  talents: number
}

export const PROBES: SaveProbe[] = [
  {
    name: '小黄鸭',
    rebirths: 17,
    insightField: undefined,
    stockAfterLoad: legacyInsightOf(17),
    live: 0,
    veins: { gather: 30, craft: 10, alchemy: 30, insight: 30 },
    talents: 33
  },
  {
    name: '白望舒',
    rebirths: 4,
    insightField: 0,
    stockAfterLoad: 0,
    live: 125,
    veins: { gather: 30, craft: 30, alchemy: 30, insight: 10 },
    talents: 11
  }
]

export function totalOf(p: SaveProbe): number {
  return p.stockAfterLoad + p.live
}

/** 存量占总宿慧的比例 */
export function stockShare(p: SaveProbe): number {
  const t = totalOf(p)
  return t === 0 ? 0 : p.stockAfterLoad / t
}

/**
 * 迁移欠账:老存档应折算却没折上的宿慧。
 * sanitize 字段缺失才走 legacyInsightOf 折算、存在则原样采信,「字段已建但转世发生在该体系之前」的存档拿到 0。
 */
export function migrationGap(p: SaveProbe): number {
  if (p.insightField === undefined) return 0
  return Math.max(0, legacyInsightOf(p.rebirths) - p.insightField)
}

/** 资质地板由哪条口径决定 */
export function aptitudeBinding(p: SaveProbe): 'count' | 'insight' {
  const byCount = REINCARNATE_APTITUDE_FLOOR * (p.rebirths + 1)
  const byInsight = Math.floor(totalOf(p) / INSIGHT_PER_APTITUDE)
  return byCount >= byInsight ? 'count' : 'insight'
}

/** 若把存量通道整个移出浅轮回,该存档会掉几阶 */
export function stageDropIfStockRemoved(p: SaveProbe): number {
  return stageAt(totalOf(p)).index - stageAt(p.live).index
}

// ============ 四、灵脉与先天之姿的存量 ============

/** 存量该按什么处理 */
export type LegacyVerdict =
  /** 历史遗产:保留既得,只改未来获取条件 */
  | 'heritage'
  /** 本世建设:该随轮回清零或折算 */
  | 'thisLife'

export interface LegacyAsset {
  id: string
  name: string
  /** 现有存档的完成度(0~1) */
  saturation: number
  /** 是否已付出不可退的代价 */
  sunkCost: boolean
  /** 轮回是否触碰它 */
  touchedByRebirth: boolean
  verdict: LegacyVerdict
  evidence: string
}

export function veinTotalOf(p: SaveProbe): number {
  return Object.values(p.veins).reduce((a, b) => a + b, 0)
}

/** 单条脉的最高投点(看主脉机制是否被用过) */
export function veinPeakOf(p: SaveProbe): number {
  return Math.max(...Object.values(p.veins))
}

/** 两份存档的平均灵脉饱和度 */
function veinSaturation(): number {
  const avg = PROBES.reduce((s, p) => s + veinTotalOf(p), 0) / PROBES.length
  return avg / VEIN_TOTAL_CAPACITY
}

/** 两份存档的平均先天之姿饱和度 */
function talentSaturation(): number {
  const avg = PROBES.reduce((s, p) => s + p.talents, 0) / PROBES.length
  return avg / TALENTS.length
}

export const LEGACY_ASSETS: LegacyAsset[] = [
  {
    id: 'veins',
    name: '灵脉',
    saturation: veinSaturation(),
    sunkCost: true,
    touchedByRebirth: false,
    verdict: 'heritage',
    evidence:
      'confirmReincarnation 折半建筑却分毫不动 veinPoints;两份真实存档均已 100/100 投满,' +
      '且每一点都付过灵石 —— 清零等于追溯性剥夺已付代价'
  },
  {
    id: 'talents',
    name: '先天之姿',
    saturation: talentSaturation(),
    sunkCost: false,
    touchedByRebirth: false,
    verdict: 'heritage',
    evidence: 'reincarnation.talents 只增不减;与灵脉同构,可照抄「保既得、改来源」的处理'
  }
]

/** 存量处理判据:轮回本就不动它即为历史遗产,清零是新增惩罚而非恢复原设计 */
export function verdictOf(a: LegacyAsset): LegacyVerdict {
  return a.touchedByRebirth ? 'thisLife' : 'heritage'
}

/** 主脉机制是否被真实玩家用过(投点超过副脉上限即为立过主脉) */
export function mainVeinEverUsed(): boolean {
  return PROBES.some(p => veinPeakOf(p) > VEIN_SIDE_CAP)
}

export { VEIN_MAIN_CAPACITY, VEIN_SIDE_CAP, VEIN_TOTAL_CAPACITY, SAMSARA_STAGES, stageAt }
