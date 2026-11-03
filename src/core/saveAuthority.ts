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
import { add, gn, gnZero, gt, mulN, sub } from '@/utils/gnum'
import type { GNum } from '@/types'
import { baseCultPerSec, expRequirement, qiCap } from '@/core/formulas'
import { QI_BANK_MULT, SUB_LEVELS } from '@/data/constants'
import { MAX_MAJOR } from '@/data/realms'
import { maxTierForMajor } from '@/data/regions'
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

/** 该境界「满产出 HOLD_HOURS 小时」的量;没有模型返回 0(调用方据此跳过) */
function holdCapOf(major: number, resource: string): number {
  const perHour = incomeOf(major)[resource] ?? 0
  return perHour > 0 ? perHour * HOLD_HOURS : 0
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

    // ---------- 修为:上限跟着「裁决后的境界」走 ----------
    const expCeil = mulN(expRequirement(nextMajor, nextSub), EXP_HOARD_LIMIT)
    const curExp = gnumOf(nextPlayer.exp)
    if (curExp !== null && gt(curExp, expCeil)) {
      corrections.push({ path: 'player.exp', before: nextPlayer.exp, after: expCeil })
      nextPlayer.exp = { ...expCeil }
      notes.push('修为超本境界持有上限')
    }

    // ---------- 资源 ----------
    if (nextRes !== null) {
      // 取「上次与本次境界的较大者」的产出模型:玩家在这一段里升过境就按高境界算,不误伤
      const capMajor = Math.max(prevRealm.major, nextMajor)
      const stoneCap = holdCapOf(capMajor, 'stone')
      const curStone = gnumOf(nextRes.spiritStone)
      if (stoneCap > 0 && curStone !== null && gt(curStone, gn(stoneCap))) {
        corrections.push({ path: 'resources.spiritStone', before: nextRes.spiritStone, after: gn(stoneCap) })
        nextRes.spiritStone = gn(stoneCap)
        notes.push(`灵石超持有上限(${stoneCap.toExponential(2)})`)
      }
      const smallFields = ['ore', 'page', 'dust', 'wudao'] as const
      for (const field of smallFields) {
        const cap = holdCapOf(capMajor, field)
        const cur = numOf(nextRes[field])
        if (cap > 0 && cur > cap) {
          corrections.push({ path: `resources.${field}`, before: nextRes[field], after: Math.floor(cap) })
          nextRes[field] = Math.floor(cap)
          notes.push(`${field} 超持有上限(${cap.toFixed(0)})`)
        }
      }
      const herbCap = holdCapOf(capMajor, 'herb')
      const herbs = objOf(nextRes.herbByGrade)
      if (herbCap > 0 && herbs !== null) {
        let touched = false
        const fixed: Record<string, number> = {}
        for (const [grade, raw] of Object.entries(herbs)) {
          const n = Math.trunc(numOf(raw))
          if (n > herbCap) touched = true
          fixed[grade] = Math.min(Math.max(n, 0), Math.floor(herbCap))
        }
        if (touched) {
          corrections.push({ path: 'resources.herbByGrade', before: nextRes.herbByGrade, after: fixed })
          nextRes.herbByGrade = fixed
          notes.push(`灵草超持有上限(${herbCap.toFixed(0)}/品)`)
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

    return { data: next, corrections, notes }
  } catch {
    // 极端畸形:交给归一化与后续兜底,不阻断存档
    return null
  }
}
