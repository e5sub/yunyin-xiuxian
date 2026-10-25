/**
 * 逆旅契:道果的非效率出口。花道果为本世签一份只加难的契,本世历练全程生效,转世记入履历;记录不进任何计算。
 * 出口空间审计:发放物不得属于 StatMods 命名空间,也不得是可兑换成它的资源。
 * 回报只能是记录:属性直落 StatMods;资源(灵石→强化→战力)、宿慧(aptitudeFloorNow→growthMult→cultivationSpeed)绕回;道果自供能。
 * 契约施加 CombatRules,每条须纯逆境(isPurelyAdverse 校验);减难即等于给效率。
 */
import type { CombatRules, StatMods } from '@/types'
import { MAX_COMBAT_ROUNDS } from '@/data/constants'

/** 这一世签下的契(存档结构) */
export interface LifeTrialState {
  trialId: string
  /** 签约时刻 */
  at: number
  /** 实付道果;只记账,不参与计算 */
  paid: number
}

export interface LifeTrialDef {
  id: string
  name: string
  /** 印文(单字) */
  seal: string
  /** 契文 */
  desc: string
  /** 规则说明(玩家可见) */
  ruleText: string
  /** 签约要花的道果 */
  cost: number
  /** 本世生效的战斗规则,只许加难 */
  rules: CombatRules
}

/** 定价:金丹圆满转世一次凝 21 枚道果;最低一档约合一世所得,最高一档需攒三世 */
export const LIFE_TRIALS: LifeTrialDef[] = [
  {
    id: 'tr_gu',
    name: '孤行契',
    seal: '孤',
    desc: '此生不假外力,伤处只能自己熬过去。',
    ruleText: '本世一切治疗效力 25%',
    cost: 24,
    rules: { healMult: 0.25 }
  },
  {
    id: 'tr_ji',
    name: '疾行契',
    seal: '疾',
    desc: '缠斗非你所长,久战必败。',
    ruleText: '本世战斗回合上限 30',
    cost: 30,
    rules: { maxRounds: 30 }
  },
  {
    id: 'tr_can',
    name: '残躯契',
    seal: '残',
    desc: '以不足之身入世,每一战都从力竭处起手。',
    ruleText: '本世每场开局气血 70%',
    cost: 36,
    rules: { playerStartHpPct: 0.7 }
  },
  {
    id: 'tr_ni',
    name: '逆锋契',
    seal: '逆',
    desc: '这一程,天地会把最凶的一面留给你。',
    ruleText: '本世敌人攻击 +30%、生命 +20%',
    cost: 48,
    rules: { enemyAtkMult: 1.3, enemyHpMult: 1.2 }
  }
]

export function lifeTrialDef(id: string): LifeTrialDef | undefined {
  return LIFE_TRIALS.find(t => t.id === id)
}

/** 违反「纯逆境」的原因;空数组表示合法 */
export function adverseViolations(rules: CombatRules): string[] {
  const bad: string[] = []
  const gte = (v: number | undefined, min: number, name: string): void => {
    if (v !== undefined && v < min) bad.push(`${name}=${v} 低于 ${min},这是在减难`)
  }
  const lte = (v: number | undefined, max: number, name: string): void => {
    if (v !== undefined && v > max) bad.push(`${name}=${v} 高于 ${max},这是在减难`)
  }
  // 对玩家不利的方向:己方倍率只能降,敌方倍率只能升
  lte(rules.playerAtkMult, 1, 'playerAtkMult')
  gte(rules.enemyAtkMult, 1, 'enemyAtkMult')
  gte(rules.enemyHpMult, 1, 'enemyHpMult')
  lte(rules.healMult, 1, 'healMult')
  lte(rules.shieldCapRatio, 1, 'shieldCapRatio')
  lte(rules.playerStartHpPct, 1, 'playerStartHpPct')
  // 回合上限以战斗真实默认为界,高于默认才是减难;另拟更小的界(如 40)会把 41~50 的合法契约误判成减难
  lte(rules.maxRounds, MAX_COMBAT_ROUNDS, 'maxRounds')
  // 属性修正:给玩家的只能是负数,给敌人的只能是正数
  const scan = (mods: StatMods | undefined, sign: 1 | -1, name: string): void => {
    for (const [k, v] of Object.entries(mods ?? {})) {
      if (typeof v === 'number' && v * sign > 0) bad.push(`${name}.${k}=${v} 方向错误`)
    }
  }
  scan(rules.playerExtraMods, 1, 'playerExtraMods')
  scan(rules.enemyExtraMods, -1, 'enemyExtraMods')
  if (rules.perRounds) bad.push('perRounds 是增益结构,契约不得携带')
  return bad
}

/** 该规则是否纯逆境 */
export function isPurelyAdverse(rules: CombatRules): boolean {
  return adverseViolations(rules).length === 0
}
