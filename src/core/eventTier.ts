/**
 * 历练三档触发 —— 际遇 / 机缘 / 奇缘
 *
 * 三档的唯一口径:归属、名称、稀度、界面色都从这里取;别处不许再写「ft_ 开头是机缘」的判据。
 * spec 钉:eventTier.spec(梯级不许倒挂)。
 */
import { CHAIN_STAGE_CHANCE, EXPLORE_EVENT_CHANCE, FORTUNE_CHANCE } from '@/data/constants'
import { chainOfEvent } from '@/data/chains'

export type EventTier = 'jingyu' | 'jiyuan' | 'qiyuan'

export interface EventTierDef {
  id: EventTier
  name: string
  /** 一句话:这一档是什么 */
  brief: string
  /** 这一档凭什么来(与代码里的触发口径同源) */
  source: string
  /** 界面用的颜色 token */
  color: string
  /** 稀有度序:数字越大越罕见。际遇 0 → 奇缘 1 → 机缘 2 */
  rarity: number
}

export const EVENT_TIERS: EventTierDef[] = [
  {
    id: 'jingyu',
    name: '际遇',
    brief: '路上撞见的事,常来',
    source: '每次遭遇都可能出事',
    color: 'var(--color-ink-soft)',
    rarity: 0
  },
  {
    id: 'qiyuan',
    name: '奇缘',
    brief: '你这条缘的下一程 —— 缘起了才会再来',
    source: '出事后取当时该走的那一程',
    color: 'var(--color-violet-ink)',
    rarity: 1
  },
  {
    id: 'jiyuan',
    name: '机缘',
    brief: '千载难逢的大机遇,取或不取都要付代价',
    source: '出事后极小概率撞上',
    color: 'var(--color-gold-ink)',
    rarity: 2
  }
]

const BY_ID = new Map(EVENT_TIERS.map(t => [t.id, t]))

export function eventTierDef(id: EventTier): EventTierDef {
  return BY_ID.get(id) ?? EVENT_TIERS[0]!
}

/** 事件所属档位;ft_ 是机缘池事件的 id 前缀(见 data/events) */
export function eventTierOf(eventId: string): EventTier {
  if (chainOfEvent(eventId)) return 'qiyuan'
  if (eventId.startsWith('ft_')) return 'jiyuan'
  return 'jingyu'
}

/**
 * 一次遭遇里各档的触发概率,须与 eventEngine.pickEventFor 的掷法逐步一致:
 *   出事(EXPLORE_EVENT_CHANCE)→ 奇缘(CHAIN_STAGE_CHANCE,仅有下一程可走时,否则取 0)
 *   → 机缘(FORTUNE_CHANCE,区域机缘池非空)→ 其余为际遇。
 * 不得写成「各档 = 出事概率 × 各自的数」的互斥抽取:三档之和会超过出事概率。
 * spec 钉:eventTier.spec 用真引擎做蒙特卡洛对账。
 */
export function tierChances(stagePending: boolean, anyChance = EXPLORE_EVENT_CHANCE): Record<EventTier, number> {
  const any = anyChance
  const chain = stagePending ? CHAIN_STAGE_CHANCE : 0
  return {
    qiyuan: any * chain,
    jiyuan: any * (1 - chain) * FORTUNE_CHANCE,
    jingyu: any * (1 - chain) * (1 - FORTUNE_CHANCE)
  }
}

/** 折成「平均多少程遭遇见一次」 */
export function tierEncountersPerTrigger(tier: EventTier, stagePending: boolean, anyChance = EXPLORE_EVENT_CHANCE): number {
  const p = tierChances(stagePending, anyChance)[tier]
  return p > 0 ? 1 / p : Number.POSITIVE_INFINITY
}

/** 界面用的一句话:「约每 6 程一次」;奇缘无缘在续时说明它为什么不来 */
export function tierOddsText(tier: EventTier, stagePending: boolean, anyChance = EXPLORE_EVENT_CHANCE): string {
  const n = tierEncountersPerTrigger(tier, stagePending, anyChance)
  if (!Number.isFinite(n)) return tier === 'qiyuan' ? '缘起之后才来' : '不出现'
  if (n < 20) return `约每 ${Math.round(n)} 程一次`
  return `约每 ${Math.round(n / 10) * 10} 程一次`
}
