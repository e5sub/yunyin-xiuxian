/**
 * 存档数值的服务端权威化 —— 「客户端上报的数值只是提议,服务端说了算」的唯一裁决点。
 *
 * 为什么要有这个模块:
 *   saveSanitize 只清理「结构上不可能」的东西(野 id / 超品阶 / 坏大数),数值本身仍然由客户端
 *   说了算。console 改 store(或改包)可以把灵石写成 e500、把境界从炼气改成真仙 —— 这些都通过了
 *   结构校验,因为它们的形状完全合法。
 *
 * 判据从哪来(三条,都由游戏自己的模型给出,不另设拍脑袋的常数):
 *   1. 境界必须「付得起」:从上次境界走到本次境界,沿途每一层的突破需求累加起来,
 *      不得超过「上次存量修为 + 这段时间理论上能产出的修为」。baseCultPerSec 是游戏自己的
 *      每秒产速,乘估算的加成上界与时间窗;跨越的大境界只按「上一境 +1」计速,
 *      否则抬高境界本身就是给预算加码。
 *   2. 资源持有量 ≤ 该境界「满产出多少小时」:每小时产出取自 core/economySim 的 auditEra
 *      (与平衡审计同一份模型,不出现第二套经济口径)。
 *   3. 装备阶数 ≤ 该境界已解锁的最高层级:maxTierForMajor 决定玩家能打到哪一层,
 *      更高层的装备没有合法来源。
 *
 * 顺序很关键:先裁境界,再用「裁后的境界」算资源与装备上限 ——
 * 反过来写,作弊者抬高境界会连带放宽所有上限,整条链就白做了。
 *
 * 边界:
 *   - 只在「已开局」的档上裁决;未开局档没有数值可裁。
 *   - 判据宁可宽:模型给不出产出(income <= 0)的资源一律跳过,不拿 0 当上限把人清零。
 *   - 只降不升:本模块从不「给」玩家东西,只把超出的部分压回合法区间。
 *   - 转世(世号增加)视为新世:境界重置与资源归零都放行,但新世的增长照旧受上一条约束。
 */
import { add, gn, gnMax, gnMin, gnZero, gt, mulN, sub } from '@/utils/gnum'
import type { GNum } from '@/types'
import { baseCultPerSec, daoFruitGain, expRequirement, qiCap } from '@/core/formulas'
import { AGE_YEARS_PER_HOUR, INSTANT_EXP_LAYER_CAP, QI_BANK_MULT, SUB_LEVELS, TALENT_DRAW_DIV } from '@/data/constants'
import { ACHIEVEMENTS, titleIdsFromAchieved } from '@/data/achievements'
import { MAX_MAJOR } from '@/data/realms'
import { maxTierForMajor } from '@/data/regions'
import { TALENTS } from '@/data/talents'
import { auditEra } from '@/core/economySim'

/** 资源持有上限按「满产出多少小时」折算:720 小时(30 天),远超任何正常囤积习惯 */
const HOLD_HOURS = 720
/** 修为产出的加成倍率上界:estimateCultMult 实测典型 2~7,给 200 是约 30 倍余量 */
const CULT_MULT_CEIL = 200
/** 单次上传至少按 60 秒计:客户端 20 秒一推,抖动与短窗口不该把正常收益卡死 */
const MIN_ELAPSED_SEC = 60
/** 单次上传最多按 7 天计:再久也按 7 天给额度,不给「挂一年再传一次」这种无限额度 */
const MAX_ELAPSED_SEC = 7 * 24 * 3600
/** 丹药每种持有上限:消耗品,给足囤积空间,只拦天文数字 */
const PILL_STACK_MAX = 9999
/** 灵气积余上限:与 player.qiBankCap 同源(qiCap × QI_BANK_MULT),再留 4 倍余量 */
const QI_HOLD_MULT = QI_BANK_MULT * 4
/** 修为持有上限相对「本境界突破需求」的倍数:正常玩家不会囤到 100 倍 */
const EXP_HOARD_LIMIT = 100
/**
 * 寿元加算(丹药/际遇)的绝对上限:百万年。
 * 正常一世能吃到的加寿是「千」到「万」的量级(蟠桃 500、仙丹 3 万),百万是百倍余量;
 * 上限只拦「填个 1e9 就永不老死」这一路,不参与任何玩法口径。
 */
const LIFESPAN_BONUS_MAX_YEARS = 1_000_000
/**
 * 单次上传之间最多允许「转世」几次。
 * 一世人寿以「时辰」计(AGE_YEARS_PER_HOUR),两次上传相距 20 秒,连转两次不可能是玩出来的。
 */
const REBIRTH_PER_UPLOAD = 1
/** 游玩时长的弛豫:客户端 tick 与上传时刻有偏差,给 5% + 60 秒余量 */
const PLAY_SEC_SLACK = 1.05
/**
 * 资源「追赶」倍率:本窗口最多长到 产速 × 窗口 × 该倍率。
 * 8 倍是给离线段各种加成(福缘/妖潮/道士加成)叠出来的余量,实测量级在 2~5 之间。
 */
const RESOURCE_CATCHUP_MULT = 8
/**
 * 资源成批进项的余量:卖装备、领奖励这类即时进项,按持有上限的这个比例放行。
 * 5% 相当于「满产 36 小时」的量 —— 卖一背包、一场首领的赏都够,而「一次写满仓」远远不够。
 */
const RESOURCE_BURST_FRACTION = 0.05

export interface AuthorityInput {
  /** 上次落库的存档 data(资源基线);首次上传为 null */
  prev: Record<string, unknown> | null
  /** 本次上传、已归一化的 data */
  next: Record<string, unknown>
  /**
   * 服务端记录的境界基线(major×100+sub,取自 profiles)。
   * 不复用 prev 里的境界:玩家删档重传时 prev 会消失,profiles 不受影响。
   */
  prevRealmIndex: number
  /** 上次落库到本次的毫秒间隔;无基线时传 0 */
  elapsedMs: number
  /**
   * 新客户端(1.57.0+)标记:境界的唯一写入口是突破 API(服务端掷点后落 profiles),
   * 上传分片里的 major/sub 一律按「提议」处理,直接压回基线 —— 转世(世号增加)除外。
   * 老客户端不带标记,沿用「付得起」预算判据(兼容旧版与自建部署的存量客户端)。
   */
  realmAuthoritative?: boolean
  /**
   * 服务端记录的**最大已见世号**(profiles.rebirths / 旧档播种值)。
   * 世号是道果与天赋的乘数底数,不能由客户端自报:两次上传之间至多一次转世,
   * 报多大就按基线放大一次,超出的压回 —— 否则「count 填 1e6」等于把永久乘区开到天上。
   */
  prevRebirths?: number
  /**
   * 上次存档之后、尚未在档里体现的支出(坊市成交 + 炼器料耗 + 升级价目)。
   * 扣款在客户端,这里把它从「各资源本窗口可增长量」里扣掉 —— 没付钱的存档必然对不上账。
   * 各键缺省按 0(1.58.3 起炼器记账,1.59.0 起功法进修/建筑升级也记账,老调用方不传不会误伤)。
   */
  pendingSpend?: {
    m: number
    e: number
    dust?: number
    ore?: number
    wudao?: number
    page?: number
    /** 门派捐献的灵草:品阶 → 尚未兑现的株数(1.68.0) */
    herb?: Record<string, number>
  }
  /**
   * 云端**已有**上次落库的档(老调用方不传按 true 处理,与 1.66 及以前行为一致)。
   *
   * 只用来区分「真首传」与「上次的档里没有这一栏」:前者要给存量档兼容(只按持有上限收),
   * 后者只可能是把分片删掉重传 —— 基线被洗成「无」之后再传满值,就能每次顶满上限(1.67.0)。
   */
  seenBefore?: boolean
  /**
   * 分解返还的尘(1.74.1):上次的档里有、这次的档里没有的装备,由服务端按台账里的
   * 权威投入复算过一次分解返还(见 server/src/salvageCredit)。
   *
   * 分解是纯客户端动作,尘又没有自己的进项账 —— 一次拆掉一批强化过的件,返还量必然
   * 越过「满产 720 小时 × 5%」这条窗口线,超出部分会被当改包压回。这笔额度是**有出处**的
   * (件真的存在过、投入真的付过),所以直接加在尘的上限之上,不受持有上限夹;
   * 其余资源没有这条通道,窗口钳制照旧。
   */
  creditDust?: number
  /**
   * 通关道源额度(1.74.1):本次上传里新增的通关道痕折出的道源,由服务端按世界/试炼的
   * 结算公式上界复算(见 server/src/daoCredit 与 core/daoCredit)。
   *
   * 道源的进项同理是有出处的(关真通了),所以直接加在道源上限之上,不受持有上限夹;
   * 没有出处的那部分照旧按窗口压回。
   */
  creditDao?: number
}

export interface AuthorityCorrection {
  /** 存档内路径,只到分片顶层字段(如 resources.spiritStone);嵌套 map 整块给 */
  path: string
  before: unknown
  after: unknown
}

export interface AuthorityReport {
  data: Record<string, unknown>
  corrections: AuthorityCorrection[]
  /** 审计摘要:每条说明「哪个字段为何被压回」 */
  notes: string[]
}

function objOf(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function numOf(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

/** 读数值;**缺字段返回 null** —— 「没基线」与「基线是 0」必须分开(旧档没有这一栏) */
function finiteNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** 读 GNum;形态非法返回 null(交给归一化兜,不在这里造值) */
function gnumOf(v: unknown): GNum | null {
  const o = objOf(v)
  if (!o) return null
  const m = numOf(o.m)
  const e = numOf(o.e)
  if (!Number.isFinite(m) || !Number.isFinite(e)) return null
  return { m, e }
}

function realmOf(index: number): { major: number; sub: number } {
  const major = Math.floor(index / 100)
  return { major, sub: Math.max(0, index - major * 100) }
}

function cmpRealm(a: { major: number; sub: number }, b: { major: number; sub: number }): number {
  return a.major !== b.major ? a.major - b.major : a.sub - b.sub
}

/** 大境界阶段的每小时产出;按境界缓存(economySim 单次 2~13ms,每次上传都跑不划算) */
const eraIncome = new Map<number, Record<string, number>>()

function incomeOf(major: number): Record<string, number> {
  const hit = eraIncome.get(major)
  if (hit !== undefined) return hit
  const flows: Record<string, number> = {}
  try {
    for (const f of auditEra(major).flows) {
      if (Number.isFinite(f.incomePerHour) && f.incomePerHour > 0) flows[f.resource] = f.incomePerHour
    }
  } catch {
    // 模型抛错就当作「没有产出模型」:下面一律跳过上限,宁可宽
  }
  eraIncome.set(major, flows)
  return flows
}

/**
 * 该境界「满产出 HOLD_HOURS 小时」的量;没有模型返回 0(调用方据此跳过)。
 * 导出给炼器采信余额用(1.66.1):同一把尺,不出现第二套持有上限口径。
 * 灵石已解除钳制(1.74.0):holdCapOf('stone') 现恒返回 0,调用方按「cap=0 不设限」跳过;
 * 其余资源仍走 economySim 的健康审计产速。
 */
export function holdCapOf(major: number, resource: string): number {
  if (resource === 'stone') return 0
  const perHour = incomeOf(major)[resource] ?? 0
  return perHour > 0 ? perHour * HOLD_HOURS : 0
}

/**
 * 修为持有上限:本境界突破需求的 EXP_HOARD_LIMIT 倍。
 * 与资源持有上限并列导出 —— 炼器采信上报修为时用同一把尺(1.66.1)。
 */
export function expHoldCap(major: number, sub: number): GNum {
  return mulN(expRequirement(major, sub), EXP_HOARD_LIMIT)
}

/** 下一层;已到顶返回 null */
function nextLayer(major: number, sub: number): { major: number; sub: number } | null {
  if (sub + 1 < SUB_LEVELS) return { major, sub: sub + 1 }
  if (major < MAX_MAJOR) return { major: major + 1, sub: 0 }
  return null
}

/** 该时间窗内理论上能产出的修为;跨大境界只按「上一境 +1」计速,防止抬高境界给预算加码 */
function expBudgetPerWindow(prevMajor: number, prevSub: number, nextMajor: number, elapsedSec: number): GNum {
  const rateMajor = Math.min(nextMajor, prevMajor + 1)
  const rate = Math.max(baseCultPerSec(prevMajor, prevSub), baseCultPerSec(rateMajor, 0))
  const span = Math.max(MIN_ELAPSED_SEC, Math.min(elapsedSec, MAX_ELAPSED_SEC))
  return gn(rate * span * CULT_MULT_CEIL)
}

/**
 * 当前境界、给定时间窗内「可信的修为增量」上限 —— 突破结算收口客户端上报修为用。
 * 与上传裁决同一把尺(同产速、同加成上界、同窗口钳制),不出现第二套口径。
 */
export function expAccrualBudget(major: number, sub: number, elapsedSec: number): GNum {
  const rate = baseCultPerSec(major, sub)
  const span = Math.max(MIN_ELAPSED_SEC, Math.min(Math.max(0, elapsedSec), MAX_ELAPSED_SEC))
  return gn(rate * span * CULT_MULT_CEIL)
}

/**
 * 从 from 起逐层上行,返回「付得起的最远境界」。
 * 预算 = 上次存量修为 + 本窗口可产出修为;每走一层扣掉该层突破需求。
 */
function affordableRealm(
  from: { major: number; sub: number },
  to: { major: number; sub: number },
  budget: GNum
): { realm: { major: number; sub: number }; blocked: boolean } {
  let cur = { ...from }
  let left = budget
  while (cmpRealm(cur, to) < 0) {
    const step = nextLayer(cur.major, cur.sub)
    if (step === null) break
    const cost = expRequirement(cur.major, cur.sub)
    if (gt(cost, left)) return { realm: cur, blocked: true }
    left = sub(left, cost)
    cur = step
  }
  return { realm: cur, blocked: false }
}

export function enforceSaveAuthority(input: AuthorityInput): AuthorityReport | null {
  try {
    const next = JSON.parse(JSON.stringify(input.next)) as Record<string, unknown>
    const nextGame = objOf(next.game)
    // 未开局:没有可裁决的数值(空档也不该被塞上限)
    if (nextGame === null || nextGame.started !== true) {
      return { data: next, corrections: [], notes: [] }
    }
    const nextPlayer = objOf(next.player)
    if (nextPlayer === null) return { data: next, corrections: [], notes: [] }

    const prevData = objOf(input.prev) ?? {}
    const prevPlayer = objOf(prevData.player) ?? {}
    const nextRes = objOf(next.resources)
    const nextInv = objOf(next.inventory)

    const corrections: AuthorityCorrection[] = []
    const notes: string[] = []

    // ---------- 世号:增加即转世,新世从零起算 ----------
    const prevCount = numOf(objOf(prevPlayer.reincarnation)?.count)
    const nextCount = numOf(objOf(nextPlayer.reincarnation)?.count)
    const rebirth = nextCount > prevCount

    // ---------- 境界 ----------
    const prevRealm = rebirth ? { major: 0, sub: 0 } : realmOf(Math.max(0, Math.trunc(input.prevRealmIndex)))
    const prevExp = rebirth ? gnZero() : (gnumOf(prevPlayer.exp) ?? gnZero())

    /*
     * 「上次的档里没有这一栏」的两种处境(1.67.0):
     *   · 真首传(云端根本没有旧档):存量档兼容,只按持有上限收 —— 老玩家不该被打回。
     *   · 已经上传过、这一栏却不在上次的档里:只可能是「删片洗基线」。
     *     若也按上限放行,「删掉 resources 传一次 → 再传满值」就是每次顶满 cap 的无限刷,
     *     与「本窗口只能涨 5% 上限」的设计正好相反。这里按**从零起**算,只给成批进项的余量。
     *   修为的增量收口(1.74.6)也吃这个区分 —— 真首传按持有上限收,续传按「上次值 + 本窗口可信产出」收。
     */
    const freshUpload = input.seenBefore !== true

    let nextMajor = Math.trunc(Math.min(Math.max(numOf(nextPlayer.major), 0), MAX_MAJOR))
    let nextSub = Math.trunc(Math.min(Math.max(numOf(nextPlayer.sub), 0), SUB_LEVELS - 1))

    // 付得起:沿途每层突破需求之和不得超过「上次修为 + 本窗口可产出修为」
    const elapsedSec = Math.max(0, input.elapsedMs) / 1000

    if (input.realmAuthoritative === true && !rebirth) {
      // 境界唯一写入口是突破 API(服务端掷点后落 profiles):上传里的 major/sub 只当提议,
      // 无论高低一律压回基线。抬境界是老路子的作弊入口;压境界只可能是改包或回档残影。
      const claimed = { major: nextMajor, sub: nextSub }
      if (claimed.major !== prevRealm.major || claimed.sub !== prevRealm.sub) {
        notes.push(`境界以服务端为准:${prevRealm.major}-${prevRealm.sub}(上报 ${claimed.major}-${claimed.sub})`)
        if (numOf(nextPlayer.major) !== prevRealm.major) {
          corrections.push({ path: 'player.major', before: nextPlayer.major, after: prevRealm.major })
        }
        if (numOf(nextPlayer.sub) !== prevRealm.sub) {
          corrections.push({ path: 'player.sub', before: nextPlayer.sub, after: prevRealm.sub })
        }
        nextMajor = prevRealm.major
        nextSub = prevRealm.sub
      }
    } else {
      // 倒退:除转世外不允许(境界是单调的,掉境意味着档被改过)
      const claimed = { major: nextMajor, sub: nextSub }
      if (!rebirth && cmpRealm(claimed, prevRealm) < 0) {
        notes.push(`境界倒退被拒:${prevRealm.major}-${prevRealm.sub} ← ${claimed.major}-${claimed.sub}`)
        nextMajor = prevRealm.major
        nextSub = prevRealm.sub
      }

      const budget = add(prevExp, expBudgetPerWindow(prevRealm.major, prevRealm.sub, nextMajor, elapsedSec))
      const affordable = affordableRealm(prevRealm, { major: nextMajor, sub: nextSub }, budget)
      if (affordable.blocked) {
        notes.push(`境界超出修为支撑:${nextMajor}-${nextSub} → ${affordable.realm.major}-${affordable.realm.sub}`)
        nextMajor = affordable.realm.major
        nextSub = affordable.realm.sub
      }
    }
    if (numOf(nextPlayer.major) !== nextMajor) {
      corrections.push({ path: 'player.major', before: nextPlayer.major, after: nextMajor })
      nextPlayer.major = nextMajor
    }
    if (numOf(nextPlayer.sub) !== nextSub) {
      corrections.push({ path: 'player.sub', before: nextPlayer.sub, after: nextSub })
      nextPlayer.sub = nextSub
    }

    // ---------- 修为:增量收口,再钳持有上限(上限跟着「裁决后的境界」走) ----------
    /*
     * 修为存量此前只验「≤ 持有上限(突破需求 ×100)」不问来源(1.74.6 补):
     * 改包把 exp 写进上界内就能落库,而突破端的收口基线正是云档存量 ——
     * 存量即假值,每一层突破都免攒,等于全程白拿挂机产出。
     * 现在按资源侧 catchUpCeil 同一把「不许一步到位」的尺收口:
     * 上限 = 上次值 + max(本窗口可信产出, 突破需求 × 0.9)。0.9 与即时进项的
     * 单层封顶 INSTANT_EXP_LAYER_CAP 同值 —— 丹药/际遇那一类「非时间性」进项
     * 每笔都不越过一层,余量给到 0.9 层不误伤;离线/闭关/历练全是时间折算,
     * 被 expAccrualBudget 覆盖(elapsedMs 含离线段,7 天封顶)。真首传按持有上限收(存量兼容)。
     * 只拦暴涨不拦回落:战败折损、突破消耗后的降低照采(与突破端同一口径)。
     */
    const expCeil = expHoldCap(nextMajor, nextSub)
    const curExp = gnumOf(nextPlayer.exp)
    if (curExp !== null) {
      const burst = gnMax(
        expAccrualBudget(nextMajor, nextSub, elapsedSec),
        mulN(expRequirement(nextMajor, nextSub), INSTANT_EXP_LAYER_CAP)
      )
      const expCap = freshUpload ? expCeil : gnMin(expCeil, add(prevExp, burst))
      if (gt(curExp, expCap)) {
        corrections.push({ path: 'player.exp', before: nextPlayer.exp, after: expCap })
        nextPlayer.exp = { ...expCap }
        notes.push(freshUpload ? '修为超本境界持有上限' : '修为超本窗口可信增量')
      }
    }

    // ---------- 成就 / 称号(1.59.1)----------
    // 境界成就是「曾经到过该大境界」的终身记号。服务端没有「历史最高境界」的台账
    // (转世后 profiles 会归零重算),所以判据取两端:
    //   · 上次存档里已有的成就一律保留 —— 那是既成历史,不是本次的提议;
    //   · 本次**新出现**的境界成就,其 major 不得超过本次裁决出的境界 ——
    //     首传(无上次档)同样适用,存量的真成就不会超过当时的真实境界。
    // 其余类型(计数/品质/特判)没有服务端可验的出处,留给台账化以后再收;称号链照收:
    // 称号的唯一来源是成就奖励,titlesOwned 与 player.titleId 都只认「裁决后成就集合」能兑现的那几枚。
    const nextQuests = objOf(next.quests)
    const rawAchieved =
      nextQuests !== null && Array.isArray(nextQuests.achieved) ? nextQuests.achieved : []
    const prevQuests = objOf(prevData.quests)
    const prevAchieved = new Set(
      Array.isArray(prevQuests?.achieved) ? prevQuests.achieved.filter((x): x is string => typeof x === 'string') : []
    )
    const kept: string[] = []
    let stripped = false
    for (const raw of rawAchieved) {
      if (typeof raw !== 'string') {
        stripped = true
        continue
      }
      const def = ACHIEVEMENTS.find(a => a.id === raw)
      if (def === undefined) {
        stripped = true
        continue
      }
      if (prevAchieved.has(raw)) {
        kept.push(raw)
        continue
      }
      if (def.cond.type === 'realm' && def.cond.major > nextMajor) {
        stripped = true
        notes.push(`境界成就越界被剥:${raw}(major ${def.cond.major} > ${nextMajor})`)
        continue
      }
      kept.push(raw)
    }
    if (nextQuests !== null && Array.isArray(nextQuests.achieved) && stripped) {
      corrections.push({ path: 'quests.achieved', before: nextQuests.achieved, after: kept })
      nextQuests.achieved = kept
    }
    // 称号链与裁决后的成就集合对齐(含没有成就被剥、但 titleId/titleOwned 被直注的情形;
    // 档里没有 quests 分片时成就集合按空算 —— 没有达成记录,就没有可兑现的称号)
    const titleFloor = titleIdsFromAchieved(kept)
    if (nextQuests !== null && Array.isArray(nextQuests.titlesOwned)) {
      const keptTitles = nextQuests.titlesOwned.filter(
        (x): x is string => typeof x === 'string' && titleFloor.has(x)
      )
      if (keptTitles.length !== nextQuests.titlesOwned.length) {
        corrections.push({ path: 'quests.titlesOwned', before: nextQuests.titlesOwned, after: keptTitles })
        nextQuests.titlesOwned = keptTitles
        notes.push('称号超出已达成成就可兑现的范围')
      }
    }
    const worn = nextPlayer.titleId
    if (typeof worn === 'string' && !titleFloor.has(worn)) {
      corrections.push({ path: 'player.titleId', before: worn, after: null })
      nextPlayer.titleId = null
      notes.push(`佩戴的称号无可兑现的成就(${worn})`)
    }

    /*
     * ---------- 资源 / 道源的共同尺 ----------
     * 取「上次与本次境界的较大者」的产出模型:玩家在这一段里升过境就按高境界算,不误伤。
     * 产出模型给的是「每小时」:统一换成小时再乘,别拿秒数直接乘(差 3600 倍)。
     * 资源与道源(界外货币)共用 elapsedHours / capMajor / catchUpCeil,不出现第二套窗口口径。
     */
    const capMajor = Math.max(prevRealm.major, nextMajor)
    const elapsedHours = Math.max(0, input.elapsedMs) / 3_600_000
    const prevRes = objOf(input.prev?.resources)
    /* freshUpload 的两种处境见境界段前的注释(修为的增量收口共用这个区分) */
    /**
     * 一次上传允许的资源**增量**(1.58.1):只看「持有上限」时,把数值一次写到上限就等于
     * 永远满仓(上限本身是 720 小时满产出的量)。这里再叠一层「追赶速度」——
     * 本窗口最多长到 `上次值 + max(产速 × 窗口 × 4, 上限 × 0.3)`。
     * 4 倍覆盖离线段的各种加成叠加,0.3 是「卖一背包、领一批奖励」这类成批进项的余量。
     *
     * 说明:这是「不许一步到位」,不是「严格按产速记账」—— 游戏里卖件、领奖都是即时的成批进项,
     * 真按产速记账会把正常玩家误判成作弊;要彻底收口得把经济动作本身搬上服务端。
     */
    const catchUpCeil = (prevValue: number | null, produced: number, cap: number): number => {
      const burst = Math.max(produced * RESOURCE_CATCHUP_MULT, cap * RESOURCE_BURST_FRACTION)
      if (prevValue === null) return freshUpload ? cap : Math.min(cap, burst)
      return Math.min(cap, prevValue + burst)
    }

    // ---------- 资源 ----------
    if (nextRes !== null) {
      /*
       * 灵石不再受持有上限钳制(1.74.0,运营决定):卖装备/卖灵草/悬赏这些模型外的成批进项
       * 攒出来的合法余额,会被「满产速 720 小时」的天花板反复裁回去 —— 玩家看到的就是
       * 「点几下强化,几亿灵石只剩零头」,GM 审计里成片的「灵石超本窗口可增长量」。
       * 改包填天文数字在灵石上从此拦不住,换取的是合法玩家余额永不被误伤;
       * 其余小资源(尘/铁/页/悟道)的窗口钳制照旧。
       */
      const smallFields = ['ore', 'page', 'dust', 'wudao'] as const
      // 未兑现的账面支出从小资源可增长量里扣(1.58.3 炼器的器灵尘;1.59.0 起建筑玄铁、
      // 功法进修的悟道点与残页也走台账):扣款写在客户端,不记账就白烧
      const s = input.pendingSpend
      const smallSpend: Record<(typeof smallFields)[number], number> = {
        dust: s !== undefined ? numOf(s.dust) : 0,
        ore: s !== undefined ? numOf(s.ore) : 0,
        page: s !== undefined ? numOf(s.page) : 0,
        wudao: s !== undefined ? numOf(s.wudao) : 0
      }
      for (const field of smallFields) {
        const cap = holdCapOf(capMajor, field)
        if (cap <= 0) continue
        const cur = numOf(nextRes[field])
        const prevVal = prevRes !== null ? finiteNum(prevRes[field]) : null
        const catchUp = catchUpCeil(prevVal, (incomeOf(capMajor)[field] ?? 0) * elapsedHours, cap)
        // 分解返还(1.74.1)只加在尘上:件真的存在过,这份尘有出处,不该被窗口线夹
        const credit = field === 'dust' ? Math.max(0, numOf(input.creditDust)) : 0
        const ceil =
          (smallSpend[field] > 0 ? Math.max(0, catchUp - smallSpend[field]) : catchUp) + credit
        if (cur > ceil) {
          corrections.push({ path: `resources.${field}`, before: nextRes[field], after: Math.floor(ceil) })
          nextRes[field] = Math.floor(ceil)
          notes.push(`${field} 超本窗口可增长量(${ceil.toFixed(0)})`)
        }
      }
      const herbCap = holdCapOf(capMajor, 'herb')
      const herbs = objOf(nextRes.herbByGrade)
      if (herbCap > 0 && herbs !== null) {
        const prevHerbs = objOf(prevRes?.herbByGrade)
        const produced = (incomeOf(capMajor).herb ?? 0) * elapsedHours
        let touched = false
        const fixed: Record<string, number> = {}
        for (const [grade, raw] of Object.entries(herbs)) {
          const n = Math.trunc(numOf(raw))
          const prevVal = prevHerbs !== null ? finiteNum(prevHerbs[grade]) : null
          // 门派捐献(1.68.0):这一品的株数要从可增长量里扣 —— 捐出去的草不能又长回来
          const donated = Math.max(0, numOf(input.pendingSpend?.herb?.[grade] ?? 0))
          const ceil = Math.max(0, catchUpCeil(prevVal, produced, herbCap) - donated)
          const capped = Math.min(Math.max(n, 0), Math.floor(ceil))
          if (capped !== n) touched = true
          fixed[grade] = capped
        }
        if (touched) {
          corrections.push({ path: 'resources.herbByGrade', before: nextRes.herbByGrade, after: fixed })
          nextRes.herbByGrade = fixed
          notes.push(`灵草超本窗口可增长量(${Math.floor(herbCap)}/品上限)`)
        }
      }
      // 灵气:瞬间资源,上限取积余容量
      const qiCeil = qiCap(nextMajor, nextSub) * QI_HOLD_MULT
      const curQi = numOf(nextRes.qi)
      if (Number.isFinite(qiCeil) && qiCeil > 0 && curQi > qiCeil) {
        corrections.push({ path: 'resources.qi', before: nextRes.qi, after: Math.floor(qiCeil) })
        nextRes.qi = Math.floor(qiCeil)
        notes.push('灵气超积余上限')
      }
    }

    // ---------- 道源:界外货币(1.67.0)----------
    /*
     * 道源是秘境 / 挑战 / 器魂凝炼 / 试炼 / 远征入场 / 虚界重掷的通用门票,此前只有
     * stores/endgame 的「越界归零」(>1e9 才作废,界内任取)。改包填一笔就能无限入场,
     * 而入场换来的掉落、器魂各有签发账,钱本身却没有出处。
     *
     * 判据不另设:界外境界的 `auditEra` 里已有一条 'daoSource' 流(furnace.potential),
     * 与灵石/灵草用同一把 holdCapOf 与同一套 catchUp 窗口。
     * 界内没有熔炉模型(cap 恒 0)时跳过 —— 那条境界的道源来源本就不由熔炉给出,
     * 拿 0 当上限会把「秘境攒下的几百道源」清零(违反本模块「模型给不出产出就不裁」的边界)。
     */
    const nextEndgame = objOf(next.endgame)
    if (nextEndgame !== null) {
      const daoCap = holdCapOf(capMajor, 'daoSource')
      if (daoCap > 0) {
        const prevDao = finiteNum(objOf(prevData.endgame)?.daoSource)
        const producedDao = (incomeOf(capMajor).daoSource ?? 0) * elapsedHours
        // 通关额度(1.74.1)只加在道源上:关真通了,这份道源有出处,不该被窗口线夹
        const credit = Math.max(0, numOf(input.creditDao))
        const ceil = catchUpCeil(prevDao, producedDao, daoCap) + credit
        const curDao = numOf(nextEndgame.daoSource)
        if (curDao > ceil) {
          corrections.push({ path: 'endgame.daoSource', before: nextEndgame.daoSource, after: Math.floor(ceil) })
          nextEndgame.daoSource = Math.floor(ceil)
          notes.push(`道源超本窗口可增长量(${Math.floor(ceil)})`)
        }
      }
    }

    // ---------- 背包:丹药堆叠与装备阶数 ----------
    if (nextInv !== null) {
      const pills = objOf(nextInv.pills)
      if (pills !== null) {
        let touched = false
        const fixed: Record<string, number> = {}
        for (const [id, raw] of Object.entries(pills)) {
          const n = Math.trunc(numOf(raw))
          if (n > PILL_STACK_MAX) touched = true
          fixed[id] = Math.min(Math.max(n, 0), PILL_STACK_MAX)
        }
        if (touched) {
          corrections.push({ path: 'inventory.pills', before: nextInv.pills, after: fixed })
          nextInv.pills = fixed
          notes.push('丹药堆叠超上限')
        }
      }
      const tierCap = maxTierForMajor(nextMajor)
      const items = nextInv.items
      if (Array.isArray(items)) {
        let touched = false
        const fixed = items.map(raw => {
          const it = objOf(raw)
          if (it === null) return raw
          const tier = Math.trunc(numOf(it.tier))
          if (tier <= tierCap) return raw
          touched = true
          return { ...it, tier: tierCap }
        })
        if (touched) {
          corrections.push({ path: 'inventory.items', before: items, after: fixed })
          nextInv.items = fixed
          notes.push(`装备阶数超境界解锁上限(tier ${tierCap})`)
        }
      }
    }

    // ---------- 转世乘区:世号 / 道果 / 天赋 ----------
    /*
     * 道果与天赋是**永久乘区**,直接加进 finalStats(daoFruit 进攻击/防御/气血乘区,
     * 天赋按 % 叠加),而它们的「自然上限」由世号唯一决定:
     *   每次转世至多得 daoFruitGain(最高境界满层) 点道果;
     *   每次转世至多取走 draws = 1 + floor(major / TALENT_DRAW_DIV) 个天赋(三选一 + 额外抽)。
     * 世号本身也不采信客户端:两次上传之间至多一次转世。三条合起来,填一个天文数字
     * 也只能拿到「这一世该有的」乘区 —— 与境界那一条同源(先裁底数,再裁派生值)。
     */
    const nextReinc = objOf(nextPlayer.reincarnation)
    if (nextReinc !== null) {
      const prevRebirths =
        input.prevRebirths !== undefined
          ? Math.max(0, Math.trunc(numOf(input.prevRebirths)))
          : // 调用方没给服务端基线(单测/老链路):退回上次存档的世号,与旧行为一致
            Math.max(0, Math.trunc(numOf(objOf(prevPlayer.reincarnation)?.count)))
      const rebirthCeil = prevRebirths + REBIRTH_PER_UPLOAD
      const claimedCount = Math.max(0, Math.trunc(numOf(nextReinc.count)))
      const count = Math.min(claimedCount, rebirthCeil)
      if (claimedCount > rebirthCeil) {
        corrections.push({ path: 'player.reincarnation.count', before: nextReinc.count, after: count })
        nextReinc.count = count
        notes.push(`世号超出服务端基线(${prevRebirths} + 1)`)
      }
      const fruitCeil = count * daoFruitGain(MAX_MAJOR, SUB_LEVELS - 1)
      const curFruit = numOf(nextReinc.daoFruit)
      if (curFruit > fruitCeil) {
        corrections.push({ path: 'player.reincarnation.daoFruit', before: nextReinc.daoFruit, after: fruitCeil })
        nextReinc.daoFruit = fruitCeil
        notes.push(`道果超世号所支撑(${count} 世 × 满境折算)`)
      }
      const talentCeil = count * (1 + Math.floor(MAX_MAJOR / TALENT_DRAW_DIV))
      const talents = nextReinc.talents
      if (Array.isArray(talents)) {
        /*
         * 内容也要验(1.67.0):只裁数量时,单世能止步于 `count × 每世抽取数` 条,
         * 但挑哪几条由客户端说了算 —— 33 个天赋里把三条最强的塞进来,形状完全合法。
         * 判据只有池内与去重两条(天赋没有第二次抽取的历史,重复 id 是改包才会出现的形状);
         * 「该抽到几品」验不了(掷点在客户端且无留痕),这条边界与计数型成就同源。
         */
        const seenTalent = new Set<string>()
        const fixedTalents = talents.filter((id): id is string => {
          if (typeof id !== 'string' || seenTalent.has(id)) return false
          if (!TALENTS.some(t => t.id === id)) return false
          seenTalent.add(id)
          return true
        })
        // 顺序即获得顺序:保留最早的,砍掉后塞进来的
        const kept = fixedTalents.slice(0, talentCeil)
        if (kept.length !== talents.length) {
          corrections.push({ path: 'player.reincarnation.talents', before: talents, after: kept })
          nextReinc.talents = kept
          notes.push(
            kept.length < fixedTalents.length
              ? `天赋数超世号所支撑(${count} 世 × 每世抽取数)`
              : '天赋含池外 id 或重复项'
          )
        }
      }
    }

    // ---------- 寿元:加算有绝对上限,年龄只能往前 ----------
    const bonusYears = numOf(nextPlayer.lifespanBonusYears)
    if (bonusYears > LIFESPAN_BONUS_MAX_YEARS) {
      corrections.push({ path: 'player.lifespanBonusYears', before: nextPlayer.lifespanBonusYears, after: LIFESPAN_BONUS_MAX_YEARS })
      nextPlayer.lifespanBonusYears = LIFESPAN_BONUS_MAX_YEARS
      notes.push('寿元加算超上限')
    }
    /*
     * 年龄:一岁 = 一个时辰(AGE_YEARS_PER_HOUR),离线结算按真实时长补,所以
     * 「本窗口能长的岁数」服务端自己算得出来。往前(变年轻)只有转世一种合法情形。
     * 只在「上次档确有基线」时裁:旧档缺 age/totalPlaySec 时按 0 当基线会把正常档打回开局。
     */
    const prevAge = finiteNum(prevPlayer.age)
    if (prevAge !== null && input.elapsedMs > 0 && !rebirth) {
      const curAge = numOf(nextPlayer.age)
      const elapsedHours = input.elapsedMs / 3_600_000
      const ageCeil = prevAge + elapsedHours * AGE_YEARS_PER_HOUR + 1
      if (curAge > ageCeil) {
        corrections.push({ path: 'player.age', before: nextPlayer.age, after: Math.floor(ageCeil) })
        nextPlayer.age = Math.floor(ageCeil)
        notes.push('年龄增长超本窗口时长')
      } else if (curAge < prevAge - 1) {
        corrections.push({ path: 'player.age', before: nextPlayer.age, after: Math.floor(prevAge) })
        nextPlayer.age = Math.floor(prevAge)
        notes.push('年龄被回拨')
      }
    }

    // ---------- 游玩时长:日切配额的唯一底数 ----------
    /*
     * totalPlaySec 派生 gameDay,垂钓/观星/悟道兑换/悬赏/卦象的「今日」全看它 ——
     * 每次上传往前推一天就等于日限无限。游玩时长不可能超过真实经过时长,按 elapsed 收口。
     */
    const prevPlay = finiteNum(objOf(input.prev?.game)?.totalPlaySec)
    if (prevPlay !== null && nextGame !== null && input.elapsedMs > 0) {
      const elapsedSec = input.elapsedMs / 1000
      const curPlay = numOf(nextGame.totalPlaySec)
      const playCeil = prevPlay + elapsedSec * PLAY_SEC_SLACK + MIN_ELAPSED_SEC
      if (curPlay > playCeil) {
        corrections.push({ path: 'game.totalPlaySec', before: nextGame.totalPlaySec, after: Math.floor(playCeil) })
        nextGame.totalPlaySec = Math.floor(playCeil)
        notes.push('游玩时长超真实经过时长')
      }
    }

    return { data: next, corrections, notes }
  } catch {
    // 极端畸形:交给归一化与后续兜底,不阻断存档
    return null
  }
}
