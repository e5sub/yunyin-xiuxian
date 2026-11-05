/**
 * 升级类动作的单一裁决点 —— 功法进修与洞府建筑升级,客户端与服务端走同一份代码。(1.59.0)
 *
 * 为什么要有这个模块:
 *   1.58.0 掉落、1.58.3 炼器收进服务端后,「功法等级」与「建筑等级」仍能靠改档白拿:
 *     · 功法 sanitize 只钳「≤ 满级」,不问悟道点/残页付没付 —— 直接把 learned 写满,
 *       perLevelMods 全额生效,这是免钱的实打实战力;
 *     · 建筑等级连造价检查都没有(setLevel 只看 0 ≤ lv ≤ maxLevel),洞府/灵田/藏经阁
 *       白拿意味着强化上限、副修席位、离线时长全线虚高;
 *   这里把两件事的决定权收回服务端(与 forgeResolve 同构):客户端(登录)只发请求,
 *   服务端无头水合云档 → 跑同一份纯账层(算价 → 验余额 → 扣款 → 升级)→ 回传改动的分片;
 *   客户端(未登录离线)与全部单测走同一条本地链,行为逐字段一致。
 *   技艺经验(skillExp)无上限的问题走读档钳制,不在这里(见 stores/lore 的 sanitize)。
 *
 * 两件事分得很清:
 *   · **算价与升级**只在这里 —— 判据只有一份(价目与门槛同 core/formulas、data/buildings),
 *     客户端自报不作数;升级是确定性动作,没有掷点;
 *   · **簿记与提示**留在客户端服务层(track/collect、toast、音效)—— 服务端跑的是临时 store,
 *     记了也会丢,索性只让它做账。
 *
 * 本模块在 Node 下运行(服务端经 server/src/routes/progress.ts 动态加载,亦入 build:vendor),
 * 不得 import 浏览器专属链路(audio / services/cloud / DOM 组件);store 在无窗环境安全。
 */
import { createPinia, setActivePinia } from 'pinia'
import type { BuildingId, GNum } from '@/types'
import { add, gn, gnZero, gt } from '@/utils/gnum'
import { MAX_MAJOR } from '@/data/realms'
import { gongfaDef, gongfaMaxLevel } from '@/data/gongfa'
import { qualityDef } from '@/data/qualities'
import { buildingDef } from '@/data/buildings'
import { INSIGHT_DISCOUNT_CAP } from '@/data/veins'
import { buildingCost, gongfaUpCost } from './formulas'
// 采信余额的天花板沿用上传裁决那把尺(1.66.1):持有上限只有一份定义,不在这里另设常数
import { holdCapOf } from './saveAuthority'
import { usePlayerStore } from '@/stores/player'
import { useResourcesStore } from '@/stores/resources'
import { useCultivationStore } from '@/stores/cultivation'
import { useDongfuStore } from '@/stores/dongfu'

/** 一次升级动作;与 POST /api/progress/op 的 body.op 一一对应 */
export type LevelOp =
  | { op: 'gongfaUpgrade'; id: string }
  /** steps = 1 单升;> 1 连升指定级数;0 = 连升到付不起为止(建筑的「连升」按钮) */
  | { op: 'buildingUpgrade'; id: BuildingId; steps: number }

/** 连升步数上限:建筑品类满级至多几十级,按数据源的最大可能再放一格 */
export const BUILDING_STEPS_MAX = 64

/** 这次动作该付的四样;调用方据此记账(服务端记 progress_spend) */
export interface LevelSpend {
  stone: GNum
  ore: number
  wudao: number
  page: number
}

/** 被拒的机读原因;客户端映射成文案 */
export type LevelBlock =
  | 'gone' // 认不出的功法/建筑 id
  | 'cap' // 功法已满级
  | 'wudao' | 'page' | 'both' // 功法进修缺料
  | 'realm' // 建筑境界未到
  | 'max' // 建筑已圆满
  | 'gate' // 洞府辖限(等级被洞府压住)
  | 'stone' | 'ore' // 建筑缺料
  | 'empty' // 连升一步都没走成且无明确拒因(理论不至,兜底)

export interface LevelDetail {
  kind: 'gongfa' | 'building'
  id: string
  /** 升级前等级(功法从 1 起,建筑从 0 起) */
  from: number
  /** 升级后等级 */
  to: number
  /** 实际升了几级(单升恒 1) */
  levels: number
  /** 建筑是否停在品类满级 */
  atMax: boolean
}

export interface LevelResult {
  ok: boolean
  /** ok=false 的拒因(机读键,客户端映射成文案) */
  reason: LevelBlock | ''
  op: LevelOp['op']
  /** 这次该付的四样(被拒时全零) */
  spend: LevelSpend
  /** 变更分片:顶层键级(服务端写回云档;客户端按它覆盖本地) */
  slices: Record<string, Record<string, unknown>>
  detail: LevelDetail
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function numOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function strOr(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function emptySpend(): LevelSpend {
  return { stone: gnZero(), ore: 0, wudao: 0, page: 0 }
}

function emptyDetail(): LevelDetail {
  return { kind: 'gongfa', id: '', from: 0, to: 0, levels: 0, atMax: false }
}

/** 校验并收口一次升级申请;形状不对返回 null(调用方拒绝结算) */
export function parseLevelOp(raw: unknown): LevelOp | null {
  if (!isPlainObject(raw)) return null
  const id = strOr(raw.id)
  if (id === '' || id.length > 64) return null
  if (raw.op === 'gongfaUpgrade') return { op: 'gongfaUpgrade', id }
  if (raw.op === 'buildingUpgrade') {
    // steps 缺省按 1;0 表示「连升到付不起」;其余夹进 [0, BUILDING_STEPS_MAX]
    const steps = Math.trunc(numOr(raw.steps, 1))
    return { op: 'buildingUpgrade', id: id as BuildingId, steps: Math.min(BUILDING_STEPS_MAX, Math.max(0, steps)) }
  }
  return null
}

/* ---------------- 价目(客户端展示与服务端裁决共用) ---------------- */

/**
 * 功法进修一层的代价(悟道点 + 残页)。
 * 满级/未习得/认不出返回 null;含寒冥灵脉的参悟折扣。
 */
export function gongfaUpgradeQuote(id: string): { wudao: number; page: number } | null {
  const cultivation = useCultivationStore()
  const def = gongfaDef(id)
  const lv = cultivation.learned[id]
  if (!def || !lv || lv >= gongfaMaxLevel(def)) return null
  const q = qualityDef(def.quality)
  const dongfu = useDongfuStore()
  const discount = Math.min(INSIGHT_DISCOUNT_CAP, dongfu.insightDiscount)
  return { wudao: Math.max(1, Math.ceil(gongfaUpCost(q.rank, lv) * (1 - discount))), page: Math.ceil(lv * (1 + q.rank * 0.5)) }
}

/** 建筑单升的门槛与代价;can=false 时 block 说明被什么拦住 */
export interface BuildingQuote {
  can: boolean
  block: 'realm' | 'max' | 'gate' | 'stone' | 'ore' | 'both' | ''
  from: number
  nextLevel: number
  stone: GNum
  ore: number
}

/** 建筑升一级的门槛(境界 / 圆满 / 洞府辖限 / 余额)与代价;与 buildingService 的展示同读一份 */
export function buildingUpgradeQuote(id: BuildingId): BuildingQuote {
  const dongfu = useDongfuStore()
  const player = usePlayerStore()
  const resources = useResourcesStore()
  const def = buildingDef(id)
  if (!def) return { can: false, block: 'realm', from: 0, nextLevel: 0, stone: gnZero(), ore: 0 }
  const lv = dongfu.levels[id] ?? 0
  const stone = buildingCost(def.costBase, lv)
  const ore = def.costOre * (lv + 1)
  const base: BuildingQuote = { can: false, block: 'realm', from: lv, nextLevel: lv + 1, stone, ore }
  if (player.major < def.unlockRealm) return base
  if (lv >= def.maxLevel) return { ...base, block: 'max' }
  if (id !== 'mansion' && lv >= dongfu.buildingLevelCap) return { ...base, block: 'gate' }
  const stoneShort = !resources.hasStone(stone)
  const oreShort = !resources.hasSmall('ore', ore)
  if (stoneShort && oreShort) return { ...base, block: 'both' }
  if (stoneShort) return { ...base, block: 'stone' }
  if (oreShort) return { ...base, block: 'ore' }
  return { ...base, can: true, block: '' }
}

/** 建筑连升的展示计划:只算不动手,逐级累加至品类满级、洞府辖限或余额缺口即止 */
export interface BuildingBatchQuote {
  levels: number
  stone: GNum
  ore: number
  /** 停下时是不是撞了品类满级 */
  atMax: boolean
  /** levels = 0 时的拒因;stone/ore 两样给的是「下一级」的价目(供列缺口) */
  block: 'realm' | 'max' | 'gate' | 'stone' | 'ore' | 'both' | ''
}

export function buildingBatchQuote(id: BuildingId): BuildingBatchQuote {
  const dongfu = useDongfuStore()
  const resources = useResourcesStore()
  const def = buildingDef(id)
  if (!def) return { levels: 0, stone: gnZero(), ore: 0, atMax: false, block: 'realm' }
  const first = buildingUpgradeQuote(id)
  if (!first.can) {
    return { levels: 0, stone: first.stone, ore: first.ore, atMax: first.block === 'max', block: first.block }
  }
  let lv = first.from
  let stone = gnZero()
  let ore = 0
  let levels = 0
  // 洞府自身不受辖限约束
  while (lv < def.maxLevel && (id === 'mansion' || lv < dongfu.buildingLevelCap)) {
    const c = buildingCost(def.costBase, lv)
    const o = def.costOre * (lv + 1)
    if (!resources.hasStone(add(stone, c)) || !resources.hasSmall('ore', ore + o)) break
    stone = add(stone, c)
    ore += o
    lv += 1
    levels += 1
  }
  return { levels, stone, ore, atMax: lv >= def.maxLevel, block: '' }
}

/* ---------------- 在「当前已激活的 store」上结算 ---------------- */

const SLICE_KEYS = ['resources', 'cultivation', 'dongfu'] as const

type AnyStore = { $state: Record<string, unknown> }

function sliceStores(): Record<(typeof SLICE_KEYS)[number], AnyStore> {
  return {
    resources: useResourcesStore() as never,
    cultivation: useCultivationStore() as never,
    dongfu: useDongfuStore() as never
  }
}

function snapshotSlices(): Record<string, string> {
  const stores = sliceStores()
  const out: Record<string, string> = {}
  for (const k of SLICE_KEYS) out[k] = JSON.stringify(stores[k].$state)
  return out
}

/** 升级会动到哪些分片:只给改动了的顶层键,缺片/没改到的不出现(免得把默认态灌进玩家档) */
function slicesDiff(before: Record<string, string>): Record<string, Record<string, unknown>> {
  const stores = sliceStores()
  const out: Record<string, Record<string, unknown>> = {}
  for (const k of SLICE_KEYS) {
    const after = JSON.stringify(stores[k].$state)
    if (after === before[k]) continue
    const post = JSON.parse(after) as Record<string, unknown>
    const pre = JSON.parse(before[k] ?? '{}') as Record<string, unknown>
    const slice: Record<string, unknown> = {}
    for (const key of Object.keys(post)) {
      if (JSON.stringify(post[key]) !== JSON.stringify(pre[key])) slice[key] = post[key]
    }
    out[k] = slice
  }
  return out
}

function reject(op: LevelOp['op'], reason: LevelBlock): LevelResult {
  return { ok: false, reason, op, spend: emptySpend(), slices: {}, detail: emptyDetail() }
}

/**
 * 在当前已激活的 store 上结算一次升级动作。
 * 客户端离线结算与服务端权威结算共用的唯一实现;被拒不升一级、不扣一样。
 */
export function resolveLevelOnStores(op: LevelOp): LevelResult {
  const before = snapshotSlices()

  if (op.op === 'gongfaUpgrade') {
    const cultivation = useCultivationStore()
    const resources = useResourcesStore()
    const def = gongfaDef(op.id)
    const lv = cultivation.learned[op.id]
    if (!def || !lv) return reject(op.op, 'gone')
    if (lv >= gongfaMaxLevel(def)) return reject(op.op, 'cap')
    const cost = gongfaUpgradeQuote(op.id)
    // 满级/未习得已在上面拦过,quote 理论不为 null;兜一道
    if (cost === null) return reject(op.op, 'cap')
    const wudaoShort = !resources.hasSmall('wudao', cost.wudao)
    const pageShort = !resources.hasSmall('page', cost.page)
    if (wudaoShort && pageShort) return reject(op.op, 'both')
    if (wudaoShort) return reject(op.op, 'wudao')
    if (pageShort) return reject(op.op, 'page')
    resources.spendSmall('wudao', cost.wudao)
    resources.spendSmall('page', cost.page)
    cultivation.upgrade(op.id)
    return {
      ok: true,
      reason: '',
      op: op.op,
      spend: { ...emptySpend(), wudao: cost.wudao, page: cost.page },
      slices: slicesDiff(before),
      detail: { kind: 'gongfa', id: op.id, from: lv, to: lv + 1, levels: 1, atMax: lv + 1 >= gongfaMaxLevel(def) }
    }
  }

  // 建筑单升 / 连升:连升逐级走同一份单升判据(每升一级余额在变,价目须重算);
  // steps = 0 表示升到付不起为止 —— 圆满闸在 quote 里,不会转飞
  const resources = useResourcesStore()
  const dongfu = useDongfuStore()
  const from = dongfu.levels[op.id] ?? 0
  const maxSteps = op.steps > 0 ? op.steps : Number.POSITIVE_INFINITY
  let stone = gnZero()
  let ore = 0
  let levels = 0
  let block: LevelBlock = 'empty'
  while (levels < maxSteps) {
    const q = buildingUpgradeQuote(op.id)
    if (!q.can) {
      block = q.block === '' ? 'empty' : (q.block as LevelBlock)
      break
    }
    resources.spendStone(q.stone)
    resources.spendSmall('ore', q.ore)
    dongfu.setLevel(op.id, q.nextLevel)
    stone = add(stone, q.stone)
    ore += q.ore
    levels += 1
  }
  if (levels === 0) return reject(op.op, block)
  const to = dongfu.levels[op.id] ?? from
  return {
    ok: true,
    reason: '',
    op: op.op,
    spend: { ...emptySpend(), stone, ore },
    slices: slicesDiff(before),
    detail: { kind: 'building', id: op.id, from, to, levels, atMax: to >= (buildingDef(op.id)?.maxLevel ?? to) }
  }
}

/* ---------------- 服务端入口:从存档分片无头结算 ---------------- */

/**
 * 客户端上报的余额;服务端取「云档值」与「上报值」的较大者,但上报值先按本境界的持有上限截断。
 * 允许高于云档是为了不误报「缺料」(本地刚拿到的东西还没上传),上限则拦住「填个天文数字当钱花」。
 */
export interface LevelClaims {
  wudao?: unknown
  page?: unknown
  ore?: unknown
  stone?: unknown
}

/** 水合时要铺开的分片:升级会读境界、余额、功法表与洞府(辖限/折扣) */
const HYDRATED_SLICES = ['player', 'resources', 'cultivation', 'dongfu'] as const

/**
 * 从云档分片无头结算一次升级(服务端走这条):
 * 临时 pinia 水合 → 采信不低于云档的上报余额 → 同一套裁决代码算价扣款 → 返回变更分片与应扣账。
 * 形状门槛(game 未开局 / op 非法)返回 null,调用方拒绝结算。
 */
export function resolveLevelFromSlices(data: unknown, rawOp: unknown, claims: LevelClaims = {}): LevelResult | null {
  if (!isPlainObject(data)) return null
  const game = isPlainObject(data.game) ? data.game : {}
  if (game.started !== true) return null
  const op = parseLevelOp(rawOp)
  if (op === null) return null

  const pinia = createPinia()
  setActivePinia(pinia)
  try {
    const playerSlice = isPlainObject(data.player) ? data.player : null
    if (playerSlice === null || !Number.isFinite(playerSlice.major)) return null
    usePlayerStore().$patch(playerSlice as never)
    const stores: Record<string, { $patch: (p: unknown) => void }> = {
      resources: useResourcesStore() as never,
      cultivation: useCultivationStore() as never,
      dongfu: useDongfuStore() as never
    }
    for (const id of HYDRATED_SLICES) {
      if (id === 'player') continue
      const slice = data[id]
      if (isPlainObject(slice)) stores[id]!.$patch(slice)
    }

    /*
     * 余额只采「不低于云档」的上报值(与炼器同规):
     * 客户端本地往往比云档新,不采信就会误报「缺料」。
     * 但采信必须有天花板(1.66.1):此前只验「是有限数」,改包填个天文数字就能拿不存在的
     * 悟道点/残页/玄铁/灵石升级 —— 花费只记进 progress_spend,到下次上传才从资源增量里扣,
     * 扣不满等于部分免费。天花板取上传裁决那把尺(core/saveAuthority 的持有上限):
     * 正常玩家的余额本来就压在这条线以下,不误伤;「未来资源」最多预支一档持有上限。
     * 只压上报值,不回压云档 —— 云档超限是上传裁决的活,这里再改一次会让两条链互相拆台。
     */
    const player = usePlayerStore()
    const resources = useResourcesStore()
    const major = Math.trunc(Math.min(Math.max(numOr(player.major, 0), 0), MAX_MAJOR))
    /** 小资源(整数)的采信值:先截到本境界上限,再交给调用方与云档取大 */
    const claimSmall = (raw: unknown, field: string): number | null => {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) return null
      const cap = holdCapOf(major, field)
      const claim = Math.max(0, Math.trunc(raw))
      // cap 为 0 表示「模型给不出产出」:不设限(与上传裁决同一处理,不拿 0 把余额清零)
      return cap > 0 ? Math.min(claim, Math.floor(cap)) : claim
    }
    const wudaoClaim = claimSmall(claims.wudao, 'wudao')
    if (wudaoClaim !== null && wudaoClaim > resources.wudao) resources.wudao = wudaoClaim
    const pageClaim = claimSmall(claims.page, 'page')
    if (pageClaim !== null && pageClaim > resources.page) resources.page = pageClaim
    const oreClaim = claimSmall(claims.ore, 'ore')
    if (oreClaim !== null && oreClaim > resources.ore) resources.ore = oreClaim
    const stoneCeil = holdCapOf(major, 'stone')
    const stoneClaim = isPlainObject(claims.stone) ? claims.stone : null
    const claimM = stoneClaim !== null ? numOr(stoneClaim.m, Number.NaN) : Number.NaN
    const claimE = stoneClaim !== null ? numOr(stoneClaim.e, Number.NaN) : Number.NaN
    if (Number.isFinite(claimM) && Number.isFinite(claimE)) {
      const claim = { m: claimM, e: claimE }
      const capped = stoneCeil > 0 && gt(claim, gn(stoneCeil)) ? gn(stoneCeil) : claim
      if (gt(capped, resources.spiritStone)) resources.spiritStone = { ...capped }
    }

    return resolveLevelOnStores(op)
  } catch {
    return null
  } finally {
    setActivePinia(undefined)
  }
}

/**
 * 把服务端回传的变更分片覆盖到本地 store(客户端编排层用)。
 * 只 patch 回传里出现的键;没有的分片不碰。
 */
export function applyLevelSlices(slices: Record<string, Record<string, unknown>> | undefined): void {
  if (!slices) return
  const stores = sliceStores() as unknown as Record<string, { $patch: (p: unknown) => void } | undefined>
  for (const [k, slice] of Object.entries(slices)) {
    stores[k]?.$patch(slice)
  }
}
