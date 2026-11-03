/**
 * 突破结算的单一裁决点 —— 客户端 UI 与服务端权威结算走同一份代码。
 *
 * 为什么要有这个模块(1.57.0):
 *   此前掷点、渡劫推演、进境全在客户端 attemptBreakthrough 里做,console 改 store 可以
 *   随意改境界 —— 数值权威化(saveAuthority)只能事后钳。现把「突破怎么判、成了/败了
 *   各自动哪些账」收进这里:
 *     客户端(登录)只发请求,服务端无头水合后跑 resolveBreakthroughOnStores 掷点结算;
 *     客户端(未登录离线)与全部单测走同一条本地链,行为与联网结算逐字段一致。
 *
 * 本模块在 Node 下运行(服务端 tsx 经 server/src/routes/cultivation.ts 动态加载),
 * 不得 import 浏览器专属链路(audio / services/cloud / DOM 组件);store 在无窗环境安全。
 * 簿记(成就计数 / 里程碑 / 音效 / 弹窗)不在这里 —— 那些是展示层的事,见 core/breakthrough。
 */
import { createPinia, setActivePinia } from 'pinia'
import { mulberry32, rng } from '@/utils/random'
import { formatNum } from '@/utils/format'
import { add, gt } from '@/utils/gnum'
import type { GNum, StatMods } from '@/types'
import {
  breakthroughExpReason,
  breakthroughPeakReason,
  breakthroughQiReason
} from '@/ui/cultivationText'
import { realmDef, realmLabel } from '@/data/realms'
import { BT_FAIL_EXP_LOSS, BT_QI_COST_RATIO } from '@/data/constants'
import { breakthroughBaseRate, clampRate } from './formulas'
import { modOf } from './statsCalc'
import { hasBreakExemption } from './heritageEffects'
import {
  rollTribulation,
  sustainScore,
  guardScore,
  waveDamage,
  tribulationWaves,
  currentTribulationRelief,
  currentStatGuard,
  NO_STAT_GUARD,
  type TribStatGuard
} from './tribulationDecision'
import { todayWeather } from './weather'
import { tribulationDef, TRIBULATIONS, type TribulationKind } from '@/data/tribulations'
import { NO_RELIEF, type TribulationRelief } from '@/data/linggenAffinity'
import { reliefFelt } from './linggenAffinity'
import { gameNow } from './enginePause'
import { breakthroughPrepState, consumeBreakthroughPrep, type BreakthroughPrepView } from './earlyGameService'
import { usePlayerStore } from '@/stores/player'
import { useResourcesStore } from '@/stores/resources'
import { useCultivationStore } from '@/stores/cultivation'
import { useInventoryStore } from '@/stores/inventory'
import { useDongfuStore } from '@/stores/dongfu'
import { snapshotFromActiveStores, type ProfileSnapshot } from './profileRecompute'
import { expAccrualBudget } from './saveAuthority'

/** 进阶成功率的一个构成项(展示用) */
export interface RatePart {
  label: string
  /** 加合值,以 1.0 = 100% 计 */
  value: number
}

export interface BreakthroughInfo {
  ready: boolean
  reason: string
  /** 修炼突破的基础成功率(未计天劫) */
  rate: number
  /** rate 的构成项,与 rate 同一批操作数;0 项省略 */
  rateParts: RatePart[]
  qiCost: number
  isMajor: boolean
  needTribulation: boolean
  targetLabel: string
  /** 突破准备状态;就绪时 rate 已并入加成(大关不食) */
  prep: BreakthroughPrepView
}

/** 蒙特卡洛采样次数;波次 4~15,几千次仍在毫秒级 */
const TRIB_SAMPLE = 4000

/**
 * 按玩家词条推演渡劫成功率:审计口径,只服务平衡审计与回归测试,不进 UI。
 * 不传 kind 时取五种劫型的平均。数学主干与 runTribulation 共用 tribulationDecision 的度量函数。
 */
export function tribulationSuccessRate(
  targetMajor: number,
  mods: StatMods,
  kind?: TribulationKind,
  relief: TribulationRelief = NO_RELIEF,
  /** 三维折算(防御→抗性 / 气血→水位);默认不传 = 只看词条,读数偏保守 */
  stat: TribStatGuard = NO_STAT_GUARD
): number {
  const kinds = kind ? [tribulationDef(kind)] : TRIBULATIONS
  const rand = mulberry32(0x5eed)
  const waves = tribulationWaves(targetMajor)
  let survived = 0
  let total = 0
  for (const def of kinds) {
    const regen = sustainScore(mods, def, relief)
    for (let s = 0; s < TRIB_SAMPLE; s += 1) {
      let hpLeft = 1 + guardScore(mods, def, relief) + stat.guard
      for (let w = 1; w <= waves; w += 1) {
        hpLeft =
          hpLeft - waveDamage(def, mods, targetMajor, w, hpLeft, relief, 1, stat) * (0.85 + rand() * 0.3) + regen
        if (hpLeft <= 0) break
      }
      if (hpLeft > 0) survived += 1
      total += 1
    }
  }
  return survived / total
}

export function breakthroughInfo(at: number = gameNow()): BreakthroughInfo {
  const player = usePlayerStore()
  const resources = useResourcesStore()
  const isMajor = player.isMajorStep
  const nextMajor = isMajor ? player.major + 1 : player.major
  const nextSub = isMajor ? 0 : player.sub + 1
  /** 大关皆劫,跨界入口(真仙/神人/混沌真灵)不例外:小进阶掷点,大关渡劫 */
  const needTribulation = isMajor
  const qiCost = Math.floor(player.qiCapValue * BT_QI_COST_RATIO)
  const mods = player.finalStats.mods
  // 就绪的突破准备并入展示率;消费在 resolveBreakthroughOnStores,一次性
  const prep = breakthroughPrepState(at)
  // 4 项操作数先各自成行再合出 rate,供界面列明细
  const baseRate = breakthroughBaseRate(player.major, player.sub)
  const rateMod = modOf(mods, 'breakthroughRate')
  const luckPart = modOf(mods, 'luck') * 0.05
  // 大关成败走 runTribulation,不吃准备加成;须与消费端(仅无劫分支)同口径
  const prepBonus = !needTribulation && prep.ready ? prep.bonus : 0
  const rateParts: RatePart[] = [{ label: '基础', value: baseRate }]
  if (rateMod !== 0) rateParts.push({ label: '词条加成', value: rateMod })
  if (luckPart !== 0) rateParts.push({ label: '气运 ×5%', value: luckPart })
  if (prepBonus !== 0) rateParts.push({ label: prep.kind === 'meditate' ? '静坐调息' : '聚气丹', value: prepBonus })
  const rawRate = baseRate + rateMod + luckPart + prepBonus
  const rate = clampRate(rawRate)
  // 越过上下限的差额单列一行:各行相加正好是展示率
  if (Math.abs(rate - rawRate) > 1e-9) rateParts.push({ label: rate < rawRate ? '封顶' : '保底', value: rate - rawRate })
  let ready = true
  let reason = ''
  if (player.atMaxRealm) {
    ready = false
    reason = breakthroughPeakReason()
  } else if (!player.expFull) {
    ready = false
    reason = breakthroughExpReason()
  } else if (resources.qi < qiCost) {
    ready = false
    reason = breakthroughQiReason(formatNum(qiCost))
  }
  return {
    ready,
    reason,
    rate,
    rateParts,
    qiCost,
    isMajor,
    needTribulation,
    targetLabel: player.atMaxRealm ? breakthroughPeakReason() : realmLabel(nextMajor, nextSub),
    prep
  }
}

/**
 * 模拟渡劫:返回(是否渡过, 战报)。与预览同源:度量函数共用 tribulationDecision,
 * 灵根解法经 currentTribulationRelief,天时乘数与 currentTribulationPlan 相同(雷鸣日+8%)。
 */
function runTribulation(targetMajor: number): { survived: boolean; log: string[] } {
  const player = usePlayerStore()
  const mods = player.finalStats.mods
  const waves = tribulationWaves(targetMajor)
  const kind = rollTribulation(targetMajor)
  const tDef = tribulationDef(kind)
  const relief = currentTribulationRelief(kind)
  const weatherMult = todayWeather().tribulationMult
  // 三维折算与预览同源(currentTribulationPlan 走同一个 helper)
  const stat = currentStatGuard()
  const regen = sustainScore(mods, tDef, relief)
  let hpLeft = 1 + guardScore(mods, tDef, relief) + stat.guard
  const log: string[] = [`乌云压顶,${realmDef(targetMajor).name}劫将至。${tDef.name}之劫,共 ${waves} 道。`]
  if (reliefFelt(relief)) log.push('你体内灵根与此劫气机相应。')
  for (let w = 1; w <= waves; w += 1) {
    hpLeft =
      hpLeft - waveDamage(tDef, mods, targetMajor, w, hpLeft, relief, weatherMult, stat) * rng.float(0.85, 1.15) + regen
    if (hpLeft <= 0) {
      log.push(`第 ${w} 道天雷轰然落下,你护体灵光崩碎,重伤坠地。`)
      return { survived: false, log }
    }
    const pct = Math.max(1, Math.round(hpLeft * 100))
    log.push(`第 ${w} 道天雷落下,你咬牙硬撼,气血余 ${Math.min(999, pct)}%。`)
  }
  log.push('雷云散尽,你于劫灰中立起,渡劫已成。')
  return { survived: true, log }
}

/** 一次突破结算的完整结果;ok=false 时除 reason 外无意义 */
export interface BreakthroughOutcome {
  ok: boolean
  /** 不就绪的原因(与 breakthroughInfo().reason 同源) */
  reason: string
  success: boolean
  isMajor: boolean
  needTribulation: boolean
  tribulationLog: string[]
  fromMajor: number
  fromSub: number
  newMajor: number
  newSub: number
}

/**
 * 在「当前已激活的 store」上结算一次突破尝试:扣灵气 → 掷点/渡劫 → 进境或赔偿。
 * 客户端离线结算与服务端权威结算共用的唯一实现;不就绪时返回 ok=false 且一分不动。
 * 簿记(成就计数 / 里程碑 / 音效 / 弹窗)不在此做 —— 见 core/breakthrough 的 attemptBreakthrough。
 */
export function resolveBreakthroughOnStores(): BreakthroughOutcome {
  const player = usePlayerStore()
  const resources = useResourcesStore()
  const cultivation = useCultivationStore()
  const info = breakthroughInfo()
  const fromMajor = player.major
  const fromSub = player.sub
  if (!info.ready) {
    return {
      ok: false,
      reason: info.reason,
      success: false,
      isMajor: info.isMajor,
      needTribulation: info.needTribulation,
      tribulationLog: [],
      fromMajor,
      fromSub,
      newMajor: fromMajor,
      newSub: fromSub
    }
  }
  resources.setQi(resources.qi - info.qiCost, player.qiCapValue)

  let success: boolean
  let tribulationLog: string[] = []
  if (info.needTribulation) {
    const result = runTribulation(player.major + 1)
    success = result.survived
    tribulationLog = result.log
  } else {
    // info.rate 已并入准备加成
    consumeBreakthroughPrep()
    success = rng.chance(info.rate)
  }

  if (success) {
    player.advanceRealm()
    cultivation.clearNegativeBuffs()
  } else {
    // 渡劫跬步(宿命传承):本世一次突破失败豁免,不散修为,跨世不带
    const exempted =
      hasBreakExemption(player.reincarnation.heritage) && player.consumeHeritageUse('dubu', 1)
    if (!exempted) {
      const mods = player.finalStats.mods
      const refund = Math.min(0.8, modOf(mods, 'breakRefund'))
      player.loseExpPct(BT_FAIL_EXP_LOSS * (1 - refund))
    }
    // 到期判定读游戏时钟(见 enginePause):写墙钟会在暂停恢复后多出一段
    cultivation.addBuff('injury', gameNow())
  }
  return {
    ok: true,
    reason: '',
    success,
    isMajor: info.isMajor,
    needTribulation: info.needTribulation,
    tribulationLog,
    fromMajor,
    fromSub,
    newMajor: player.major,
    newSub: player.sub
  }
}

/* ---------------- 服务端入口:从存档分片无头结算 ---------------- */

/** 结算改动的字段,按分片分组(顶层键级 diff;只含确实变化的键,键序不动) */
type SlicePatches = Record<string, Record<string, unknown>>

export interface BreakthroughResolveResult {
  outcome: BreakthroughOutcome
  /** 被结算改动的字段;客户端 $patch 应用,服务端并进存档 */
  patches: SlicePatches
  /** 结算后的档案快照(给 profiles 落账用);复算链失败为 null */
  snapshot: ProfileSnapshot | null
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function numOf(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

/** 读 GNum;形态非法返回 null(不在这里造值) */
function gnumOf(v: unknown): GNum | null {
  const o = isPlainObject(v) ? v : null
  if (o === null) return null
  const m = numOf(o.m)
  const e = numOf(o.e)
  if (!Number.isFinite(m) || !Number.isFinite(e)) return null
  return { m, e }
}

/** 结算会改账的三个分片;克隆走 JSON(分片本身就是可序列化的纯数据) */
const TRACKED_SLICES = ['player', 'resources', 'cultivation'] as const

function stateClone(): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {}
  const player = usePlayerStore()
  const resources = useResourcesStore()
  const cultivation = useCultivationStore()
  const stores: Record<string, unknown> = { player, resources, cultivation }
  for (const id of TRACKED_SLICES) {
    out[id] = JSON.parse(JSON.stringify((stores[id] as { $state: unknown }).$state)) as Record<string, unknown>
  }
  return out
}

/** 顶层键级 diff:值按 JSON 比较,嵌套结构整块给(与上传 corrections 的口径一致) */
function diffSlices(
  before: Record<string, Record<string, unknown>>,
  after: Record<string, Record<string, unknown>>
): SlicePatches {
  const out: SlicePatches = {}
  for (const slice of Object.keys(before)) {
    const b = before[slice]!
    const a = after[slice]!
    const fields: Record<string, unknown> = {}
    for (const key of Object.keys(a)) {
      if (JSON.stringify(b[key]) !== JSON.stringify(a[key])) fields[key] = a[key]
    }
    if (Object.keys(fields).length > 0) out[slice] = fields
  }
  return out
}

export interface BreakthroughClaims {
  /** 客户端当前修为(GNum);服务端按「存量 + 产出预算」收口后采信 */
  exp?: unknown
  /** 客户端当前灵气;按积余容量收口后采信 */
  qi?: unknown
}

export interface BreakthroughResolveCtx {
  /** 上次落库到现在的秒数;上报修为的可信增量按此窗口折算 */
  elapsedSec: number
}

/**
 * 从云档分片无头结算一次突破(服务端走这条):
 * 临时 pinia 水合 → 收口客户端上报的修为/灵气 → 同一套裁决代码掷点 → 顶层键级 diff。
 * 形状门槛(player 分片缺 major/sub、未开局)或链路抛错返回 null,调用方拒绝结算。
 */
export function resolveBreakthroughFromSlices(
  data: unknown,
  claims: BreakthroughClaims,
  ctx: BreakthroughResolveCtx
): BreakthroughResolveResult | null {
  if (typeof data !== 'object' || data === null) return null
  const raw = data as Record<string, unknown>
  const game = isPlainObject(raw.game) ? raw.game : {}
  if (game.started !== true) return null
  const playerSlice = isPlainObject(raw.player) ? raw.player : null
  if (playerSlice === null || !Number.isFinite(playerSlice.major) || !Number.isFinite(playerSlice.sub)) return null

  const pinia = createPinia()
  setActivePinia(pinia)
  try {
    usePlayerStore().$patch(playerSlice as never)
    for (const [id, store] of [
      ['inventory', useInventoryStore()],
      ['cultivation', useCultivationStore()],
      ['dongfu', useDongfuStore()],
      ['resources', useResourcesStore()]
    ] as const) {
      const slice = raw[id]
      if (isPlainObject(slice)) (store as unknown as { $patch: (p: unknown) => void }).$patch(slice)
    }
    const player = usePlayerStore()
    const resources = useResourcesStore()

    // 修为:上报值超出「存量 + 本窗口可信产出」的部分不采信;合法值(含合法消耗后的降低)照采
    const claimExp = gnumOf(claims.exp)
    if (claimExp !== null) {
      const stored = player.exp
      const ceiling = add(stored, expAccrualBudget(player.major, player.sub, ctx.elapsedSec))
      player.exp = gt(claimExp, ceiling) ? stored : claimExp
    }
    // 灵气:瞬间资源,超出积余容量的部分不采信(等几秒也能攒回来,不值得为它拒结算)
    if (Number.isFinite(claims.qi)) {
      resources.qi = Math.min(Math.max(Math.trunc(numOf(claims.qi)), 0), Math.max(0, Math.floor(player.qiCapValue)))
    }

    const before = stateClone()
    const outcome = resolveBreakthroughOnStores()
    const patches = outcome.ok ? diffSlices(before, stateClone()) : {}
    const snapshot = outcome.ok ? snapshotFromActiveStores() : null
    return { outcome, patches, snapshot }
  } catch {
    return null
  } finally {
    setActivePinia(undefined)
  }
}
