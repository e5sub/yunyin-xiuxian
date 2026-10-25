/**
 * 道果职责拆分审计:把道果的全部引用点归类,度量战力与修炼速度两个职责的量级、
 * 各自怎样反馈回轮回,以及剥离速度职责的反事实。只做度量,不改数值。
 */
import { effectiveDaoFruit } from './statsCalc'
import { fruitAtLife, lifeTable, saturationLife, speedupAt } from './compoundingAudit'
import { DAO_FRUIT_COMBAT_BONUS, DAO_FRUIT_CULT_BONUS, DAO_FRUIT_SOFT_EXP } from '@/data/constants'

// ============ 一、引用点归类 ============

/** 引用点的角色:只有 `speed` 与 `power` 是真消费者(读道果并产生游戏效果),其余三类不改任何数值 */
export type FruitRole =
  /** 消费者:转成修炼速度 */
  | 'speed'
  /** 消费者:转成战力 */
  | 'power'
  /** 生产端:发放与累加 */
  | 'production'
  /** 展示与引导:只读不算 */
  | 'display'
  /** 审计模拟:不在游戏逻辑内 */
  | 'sim'

/** 这个职责是否必须由道果承担 */
export type Necessity =
  /** 非道果不可 */
  | 'must'
  /** 历史遗留 */
  | 'legacy'
  /** 可换别的来源承担 */
  | 'replaceable'

/** 反馈回轮回的方式 */
export type LoopKind =
  /** 直接进闭环:更快 → 更早轮回 → 更多道果 */
  | 'direct'
  /** 间接进闭环:战力 → 历练更顺 → 收益更快 → 更早轮回 */
  | 'indirect'
  /** 不进闭环 */
  | 'none'

export interface FruitConsumer {
  id: string
  name: string
  /** 代码位置 */
  site: string
  role: FruitRole
  necessity: Necessity | null
  loop: LoopKind
  evidence: string
}

/** 道果的全部引用点。道果无消费出口,只被 computeFinalStats 读一次,同时喂给两个乘区 */
export const FRUIT_CONSUMERS: FruitConsumer[] = [
  {
    id: 'cultSpeed',
    name: '修炼速度',
    site: 'statsCalc.computeFinalStats → cultExtra',
    role: 'speed',
    necessity: 'legacy',
    loop: 'direct',
    evidence: `cultExtra += effectiveDaoFruit(fruit) × ${DAO_FRUIT_CULT_BONUS};直接构成「更快→更早轮回→更多道果」的闭环`
  },
  {
    id: 'combat',
    name: '战力',
    site: 'statsCalc.computeFinalStats → combatBonus',
    role: 'power',
    necessity: 'must',
    loop: 'indirect',
    evidence: `attack/defense/maxHp 各乘 (1 + … + fruit^${DAO_FRUIT_SOFT_EXP} × ${DAO_FRUIT_COMBAT_BONUS});是玩家对「轮回有用」的主要体感来源`
  },
  {
    id: 'gain',
    name: '转世凝结',
    site: 'reincarnation.confirmReincarnation → player.addDaoFruit',
    role: 'production',
    necessity: null,
    loop: 'none',
    evidence: 'daoFruitGain(major, sub) 按终点境界发放,是唯一产出口'
  },
  {
    id: 'view',
    name: '界面展示',
    site: 'CharacterView / ReincarnationDialog / ui.daoFruitGained',
    role: 'display',
    necessity: null,
    loop: 'none',
    evidence: '只读数字,不参与任何计算'
  },
  {
    id: 'guide',
    name: '资源引导',
    site: 'resourceGuidance.daoFruitDialog / endgame.daoFruitTutorialSeen',
    role: 'display',
    necessity: null,
    loop: 'none',
    evidence: '首次获得时的说明弹窗与已读标记,不改变数值'
  },
  {
    id: 'sim',
    name: '成长模拟',
    site: 'progressionSim.estimateCultMult',
    role: 'sim',
    necessity: null,
    loop: 'none',
    evidence: '审计口径复刻 computeFinalStats 的速度项,不在游戏逻辑内'
  }
]

export function realConsumers(): FruitConsumer[] {
  return FRUIT_CONSUMERS.filter(c => c.role === 'speed' || c.role === 'power')
}

/** 猜测过、实际与道果无关的系统 */
export const NOT_FRUIT_DRIVEN: readonly { name: string; actual: string }[] = [
  { name: '轮回阶位', actual: '走宿慧 totalInsight(存量+认知折算),与道果无关' },
  { name: '天界与道痕', actual: 'endgameUnlocked() 只看 major >= WORLD_BREAK_MAJOR(真仙)' },
  { name: '本世命题', actual: 'lifeThemes 按阶位开放,奖励是宿慧不是道果' },
  { name: '先天之姿', actual: '每世抽取,数量按 major,与道果无关' },
  { name: '灵根资质', actual: 'aptitudeFloorNow = max(次数×5, 宿慧/12)' }
]

// ============ 二、两个职责的量级 ============

export interface RoleMagnitude {
  life: number
  fruit: number
  /** 软化后的有效道果 */
  effective: number
  /** 速度职责:加到 cultivationSpeed 上的绝对量 */
  speedAdd: number
  /** 战力职责:attack/defense/maxHp 的乘区倍数 */
  powerMult: number
}

/** 逐世的两职责量级(按金丹轮回累计) */
export function roleMagnitudes(lives: number): RoleMagnitude[] {
  const out: RoleMagnitude[] = []
  for (let life = 1; life <= lives; life += 1) {
    const fruit = fruitAtLife(life)
    const eff = effectiveDaoFruit(fruit)
    out.push({
      life,
      fruit,
      effective: eff,
      speedAdd: eff * DAO_FRUIT_CULT_BONUS,
      powerMult: 1 + eff * DAO_FRUIT_COMBAT_BONUS
    })
  }
  return out
}

// ============ 三、反事实:剥离速度职责 ============

export interface Counterfactual {
  life: number
  /** 现状:两职责都在 */
  now: number
  /** 剥离速度职责后的提速(道果只给战力) */
  withoutSpeed: number
  /** 正反馈被削掉的比例 */
  removed: number
}

/**
 * 若道果不再进 cultivationSpeed,长期正反馈还剩多少。
 * 等价于把耗时模型里的道果项置零(estimateCultMult 中道果只进速度);余下提速全来自资质地板。
 */
export function counterfactualAt(life: number): Counterfactual {
  const now = speedupAt(life, 'both')
  const withoutSpeed = speedupAt(life, 'linggen')
  return { life, now, withoutSpeed, removed: (now - withoutSpeed) / (now - 1) }
}

/**
 * 无界(不会饱和)、自动(无需玩家操作即汇入下一世效率)复利项的数量。
 * 资质地板/称号/灵兽都会饱和,剥离速度职责后归零。
 */
export function unboundedLoopCount(speedRoleAttached: boolean): number {
  return speedRoleAttached ? 1 : 0
}

/** 剥离速度职责后,提速在第几世彻底停止增长 */
export function loopStopsAtLife(): number {
  return saturationLife()
}

/** 长期提速的稳态值(剥离速度职责后) */
export function steadySpeedupWithoutSpeedRole(lives = 30): number {
  const t = lifeTable(lives, 'linggen')
  return 1 / t[t.length - 1]!.vsFirst
}

export { DAO_FRUIT_COMBAT_BONUS, DAO_FRUIT_CULT_BONUS, DAO_FRUIT_SOFT_EXP }
