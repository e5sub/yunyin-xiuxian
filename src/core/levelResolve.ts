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
import { add, gn, gnZero, gt, mulN, ratio } from '@/utils/gnum'
import { MAX_MAJOR } from '@/data/realms'
import { gongfaDef, gongfaMaxLevel, GONGFA } from '@/data/gongfa'
import { qualityDef } from '@/data/qualities'
import { buildingDef } from '@/data/buildings'
import type { VeinId } from '@/data/veins'
import {
  VEIN_MAIN_CAPACITY,
  VEIN_POINT_STONE,
  VEIN_SIDE_CAP,
  VEIN_TOTAL_CAPACITY,
  VEIN_UNLOCK_MAJOR
} from '@/data/constants'
import { maxTierForMajor } from '@/data/regions'
import { ARTIFACT_MAX_LEVEL, artifactDef } from '@/data/artifacts'
import { INSIGHT_DISCOUNT_CAP } from '@/data/veins'
import { COMPREHEND_PAGE_COST } from '@/data/constants'
import { gongfaAffinity, rootElements } from './linggenAffinity'
import { artifactUpCostAt } from './artifactCost'
import { rng } from '@/utils/random'
import { buildingCost, gongfaUpCost, stoneByTier } from './formulas'
import { cutCount, cutGNum, getVipResolver, setVipResolver } from './spendRate'
// 采信余额的天花板沿用上传裁决那把尺(1.66.1):持有上限只有一份定义,不在这里另设常数
import { holdCapOf } from './saveAuthority'
import { usePlayerStore } from '@/stores/player'
import { useResourcesStore } from '@/stores/resources'
import { useCultivationStore } from '@/stores/cultivation'
import { useDongfuStore } from '@/stores/dongfu'
import { useInventoryStore } from '@/stores/inventory'

/** 一次升级动作;与 POST /api/progress/op 的 body.op 一一对应 */
export type LevelOp =
  | { op: 'gongfaUpgrade'; id: string }
  /** 藏经阁参悟:花残页随机习得一部(1.67.0 收进服务端 —— 客户端自选/自掷等于免残页拿功法) */
  | { op: 'gongfaLearn' }
  /** 法宝祭炼:steps = 1 单炼,0 = 连炼到付不起(1.67.0 收进服务端 —— 重数此前可直接改档写满) */
  | { op: 'artifactUpgrade'; defId: string; steps: number }
  /** 灵脉投点:points = 1 单投,0 = 投到付不起(1.67.0 收进服务端 —— 点数此前可改档写满) */
  | { op: 'veinInvest'; id: VeinId; points: number }
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
  | 'learned' // 参悟:能学的已经学尽
  | 'wudao' | 'page' | 'both' // 功法进修缺料
  | 'realm' // 建筑境界未到
  | 'max' // 建筑已圆满
  | 'gate' // 洞府辖限(等级被洞府压住)
  | 'stone' | 'ore' // 建筑缺料
  | 'empty' // 连升一步都没走成且无明确拒因(理论不至,兜底)

export interface LevelDetail {
  kind: 'gongfa' | 'building' | 'artifact' | 'vein'
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
  // 参悟不带 id(学哪部由池中随机决定):先于 id 校验处理
  if (raw.op === 'gongfaLearn') return { op: 'gongfaLearn' }
  if (raw.op === 'veinInvest') {
    const veinId = strOr(raw.id)
    if (veinId === '' || veinId.length > 64) return null
    const points = Math.trunc(numOr(raw.points, 1))
    return { op: 'veinInvest', id: veinId as VeinId, points: Math.min(VEIN_TOTAL_CAPACITY, Math.max(0, points)) }
  }
  if (raw.op === 'artifactUpgrade') {
    const defId = strOr(raw.defId)
    if (defId === '' || defId.length > 64) return null
    // steps 缺省按 1;0 表示「连炼到付不起」;上限同建筑连升(64 步足够走满九重)
    const steps = Math.trunc(numOr(raw.steps, 1))
    return { op: 'artifactUpgrade', defId, steps: Math.min(BUILDING_STEPS_MAX, Math.max(0, steps)) }
  }
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
  return {
    wudao: cutCount(Math.max(1, Math.ceil(gongfaUpCost(q.rank, lv) * (1 - discount)))),
    page: cutCount(Math.ceil(lv * (1 + q.rank * 0.5)))
  }
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
  // VIP 有效期内九折:价签(buildingUpgradeQuote / buildingBatchQuote)、
  // 客户端本地结算与服务端无头结算读的是同一处
  const stone = cutGNum(buildingCost(def.costBase, lv))
  const ore = cutCount(def.costOre * (lv + 1))
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

const SLICE_KEYS = ['resources', 'cultivation', 'dongfu', 'inventory'] as const

type AnyStore = { $state: Record<string, unknown> }

function sliceStores(): Record<(typeof SLICE_KEYS)[number], AnyStore> {
  return {
    resources: useResourcesStore() as never,
    cultivation: useCultivationStore() as never,
    dongfu: useDongfuStore() as never,
    // 祭炼改的是 inventory.artifacts(1.67.0):分片差异要看得见,回传与本地覆盖才有依据
    inventory: useInventoryStore() as never
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

  /*
   * 参悟(1.67.0):此前整条链在客户端 —— 花残页、从池里随机挑一部。改包可以直接把
   * 79 门功法写进 learned(每门 1 级被动),连残页都不用花;保留「每窗口新增至多一部」的
   * 兜底也只是把一次塞满拆成 79 次上传。收进这里后,习得也有台账(见 level_state)。
   * 池条件与权重与 core/gongfaService 的 comprehendGongfa 同源,未登录离线仍走那一条。
   */
  if (op.op === 'gongfaLearn') {
    const cultivation = useCultivationStore()
    const resources = useResourcesStore()
    const player = usePlayerStore()
    // VIP 有效期内九折:与价签、客户端本地链读同一个 cutCount
    const cost = cutCount(COMPREHEND_PAGE_COST)
    const pool = GONGFA.filter(g => g.minRealm <= player.major + 1 && !cultivation.learned[g.id])
    if (pool.length === 0) return reject(op.op, 'learned')
    if (!resources.hasSmall('page', cost)) return reject(op.op, 'page')
    // 权重同源:品阶越高越稀;与玩家灵根同源者更易(与 gongfaService 的加权一致)
    const elements = rootElements(player.linggen?.roots)
    const picked = rng.weighted(
      pool,
      g => (100 / (1 + qualityDef(g.quality).rank * 1.5)) * gongfaAffinity(g.element, elements)
    )
    resources.spendSmall('page', cost)
    cultivation.learn(picked.id)
    return {
      ok: true,
      reason: '',
      op: op.op,
      spend: { ...emptySpend(), page: cost },
      slices: slicesDiff(before),
      detail: { kind: 'gongfa', id: picked.id, from: 0, to: 1, levels: 1, atMax: false }
    }
  }

  /*
   * 法宝祭炼(1.67.0):此前升级完完全全在客户端 —— 算价、扣悟道点与灵石、改 artifacts[].level
   * 三件事都在本地,artifacts 又没有台账(equip_state 只管 items),于是改档把重数写成 9
   * 就是满重被动直接进 finalStats。这里收进服务端后,重数与功法/建筑等级同住 level_state
   * (kind='artifact',itemId=defId),上传时按台账压回。
   * 价目走 core/artifactCost —— 与客户端价签同一份,不外挂第二套指数。
   */
  if (op.op === 'artifactUpgrade') {
    const inventory = useInventoryStore()
    const resources = useResourcesStore()
    const owned = inventory.artifacts.find(a => a.defId === op.defId)
    const def = artifactDef(op.defId)
    if (!owned || !def) return reject(op.op, 'gone')
    const from = Number.isFinite(owned.level) ? Math.max(0, Math.floor(owned.level)) : 0
    const maxSteps = op.steps > 0 ? op.steps : Number.POSITIVE_INFINITY
    let wudao = 0
    let stone = gnZero()
    let levels = 0
    let block: LevelBlock = 'cap'
    while (levels < maxSteps) {
      const cost = artifactUpCostAt(def, useInventoryStore().artifacts.find(a => a.defId === op.defId)?.level ?? 0)
      if (cost === null) {
        block = 'cap'
        break
      }
      const wudaoShort = !resources.hasSmall('wudao', cost.wudao)
      const stoneShort = !resources.hasStone(cost.stone)
      if (wudaoShort && stoneShort) {
        block = 'both'
        break
      }
      if (wudaoShort) {
        block = 'wudao'
        break
      }
      if (stoneShort) {
        block = 'stone'
        break
      }
      resources.spendSmall('wudao', cost.wudao)
      resources.spendStone(cost.stone)
      if (!inventory.levelUpArtifact(op.defId)) {
        // 理论上到不了(上面已按满重拦过):退回本步,不白扣
        resources.addSmall('wudao', cost.wudao)
        resources.addStone(cost.stone)
        block = 'cap'
        break
      }
      wudao += cost.wudao
      stone = add(stone, cost.stone)
      levels += 1
    }
    if (levels === 0) return reject(op.op, block)
    const to = inventory.artifacts.find(a => a.defId === op.defId)?.level ?? from
    return {
      ok: true,
      reason: '',
      op: op.op,
      spend: { ...emptySpend(), wudao, stone },
      slices: slicesDiff(before),
      detail: { kind: 'artifact', id: op.defId, from, to, levels, atMax: to >= ARTIFACT_MAX_LEVEL }
    }
  }

  /*
   * 灵脉投点(1.67.0):veinPoints 此前没有任何台账,而它是**服务端算价的输入** ——
   * levelResolve 的 gongfaUpgradeQuote 会读 dongfu.insightDiscount 折悟道点。
   * 客户端把 insight 写满,服务端就按折扣价记账(折扣上限 50%,但那是实打实的少付)。
   * 顺带:点数本身也是采集加成与祭炼折扣的来源,写满等于白拿 100 点投资。
   * 收进这里后重数与功法/建筑/法宝同住 level_state(kind='vein')。
   * 主脉迁移(switchMainVein)不在此列:它只重分配已投的点数,不产生新点数,自成一处小加固。
   */
  if (op.op === 'veinInvest') {
    const dongfu = useDongfuStore()
    const resources = useResourcesStore()
    const player = usePlayerStore()
    if (player.major < VEIN_UNLOCK_MAJOR) return reject(op.op, 'realm')
    if (dongfu.veinTotal >= VEIN_TOTAL_CAPACITY) return reject(op.op, 'max')
    const cap = dongfu.veinMain === null || dongfu.veinMain === op.id ? VEIN_MAIN_CAPACITY : VEIN_SIDE_CAP
    const current = dongfu.veinPoints[op.id] ?? 0
    const maxByCap = Math.min(cap - current, VEIN_TOTAL_CAPACITY - dongfu.veinTotal)
    if (maxByCap <= 0) return reject(op.op, 'max')
    // 单点价与 veinService.veinPointCost 同源:层级取本境界、VIP 九折(两端同值)
    const unit = cutGNum(stoneByTier(maxTierForMajor(player.major), VEIN_POINT_STONE))
    const affordable = ratio(resources.spiritStone, unit)
    const byStone = Number.isFinite(affordable) ? Math.floor(affordable) : maxByCap
    const want = op.points > 0 ? Math.min(op.points, maxByCap) : maxByCap
    const points = Math.min(want, Math.max(0, byStone))
    if (points <= 0) return reject(op.op, 'stone')
    const total = mulN(unit, points)
    // 立主须在所有守卫之后(被拒的点击不得占主脉):与 veinService 同规
    if (dongfu.veinMain === null) dongfu.setVeinMain(op.id)
    resources.spendStone(total)
    dongfu.addVeinPoint(op.id, points)
    const to = dongfu.veinPoints[op.id] ?? current + points
    return {
      ok: true,
      reason: '',
      op: op.op,
      spend: { ...emptySpend(), stone: total },
      slices: slicesDiff(before),
      detail: { kind: 'vein', id: op.id, from: current, to, levels: points, atMax: dongfu.veinTotal >= VEIN_TOTAL_CAPACITY }
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
const HYDRATED_SLICES = ['player', 'resources', 'cultivation', 'dongfu', 'inventory'] as const

/**
 * 从云档分片无头结算一次升级(服务端走这条):
 * 临时 pinia 水合 → 采信不低于云档的上报余额 → 同一套裁决代码算价扣款 → 返回变更分片与应扣账。
 * 形状门槛(game 未开局 / op 非法)返回 null,调用方拒绝结算。
 *
 * @param vip 本单是不是 VIP(服务端读 users.vip_until 传进来)。结算全程同步,注入器在同一 tick 内设/还原。
 */
export function resolveLevelFromSlices(
  data: unknown,
  rawOp: unknown,
  claims: LevelClaims = {},
  vip = false
): LevelResult | null {
  if (!isPlainObject(data)) return null
  const game = isPlainObject(data.game) ? data.game : {}
  if (game.started !== true) return null
  const op = parseLevelOp(rawOp)
  if (op === null) return null

  const pinia = createPinia()
  setActivePinia(pinia)
  const prevVip = getVipResolver()
  setVipResolver(() => vip)
  try {
    const playerSlice = isPlainObject(data.player) ? data.player : null
    if (playerSlice === null || !Number.isFinite(playerSlice.major)) return null
    usePlayerStore().$patch(playerSlice as never)
    const stores: Record<string, { $patch: (p: unknown) => void }> = {
      resources: useResourcesStore() as never,
      cultivation: useCultivationStore() as never,
      dongfu: useDongfuStore() as never,
      inventory: useInventoryStore() as never
    }
    for (const id of HYDRATED_SLICES) {
      if (id === 'player') continue
      const slice = data[id]
      if (isPlainObject(slice)) stores[id]!.$patch(slice)
    }

    /*
     * 余额以上报值为准(1.73.0 与炼器同修「清空资源」):
     * 钱是客户端本地付的,服务端排计划就只能用客户端此刻真实持有的余额。
     * 此前只升不降(取 max(云档, 上报)),云档 20 秒一推,两次上传之间本地花过钱,
     * 云档就比本地高 —— 服务端拿旧的高余额排单、按它收全额,本地被钳到 0。
     * 上报偏低也不吃亏:计划按低余额排、扣得少,云档的钱分文不少。
     * 天花板仍取持有上限(1.66.1):改包填天文数字预支未来资源的路照旧堵死。
     * 只压上报值,不回压云档 —— 云档超限是上传裁决的活,这里再改一次会让两条链互相拆台。
     */
    const player = usePlayerStore()
    const resources = useResourcesStore()
    const major = Math.trunc(Math.min(Math.max(numOr(player.major, 0), 0), MAX_MAJOR))
    /** 小资源(整数)的采信值:截到本境界上限;上报偏低照采 —— 服务端只花真实持有的钱 */
    const claimSmall = (raw: unknown, field: string): number | null => {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) return null
      const cap = holdCapOf(major, field)
      const claim = Math.max(0, Math.trunc(raw))
      // cap 为 0 表示「模型给不出产出」:不设限(与上传裁决同一处理,不拿 0 把余额清零)
      return cap > 0 ? Math.min(claim, Math.floor(cap)) : claim
    }
    const wudaoClaim = claimSmall(claims.wudao, 'wudao')
    if (wudaoClaim !== null) resources.wudao = wudaoClaim
    const pageClaim = claimSmall(claims.page, 'page')
    if (pageClaim !== null) resources.page = pageClaim
    const oreClaim = claimSmall(claims.ore, 'ore')
    if (oreClaim !== null) resources.ore = oreClaim
    const stoneCeil = holdCapOf(major, 'stone')
    const stoneClaim = isPlainObject(claims.stone) ? claims.stone : null
    const claimM = stoneClaim !== null ? numOr(stoneClaim.m, Number.NaN) : Number.NaN
    const claimE = stoneClaim !== null ? numOr(stoneClaim.e, Number.NaN) : Number.NaN
    if (Number.isFinite(claimM) && Number.isFinite(claimE)) {
      const claim = { m: claimM, e: claimE }
      resources.spiritStone = { ...(stoneCeil > 0 && gt(claim, gn(stoneCeil)) ? gn(stoneCeil) : claim) }
    }

    return resolveLevelOnStores(op)
  } catch {
    return null
  } finally {
    setActivePinia(undefined)
    setVipResolver(prevVip)
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
