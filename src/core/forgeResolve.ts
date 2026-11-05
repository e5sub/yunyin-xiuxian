/**
 * 炼器结算的单一裁决点 —— 强化 / 重铸 / 自动重铸 / 词条转移,客户端与服务端走同一份代码。
 *
 * 为什么要有这个模块(1.58.3):
 *   1.58.0 把**掉落**收进了服务端签发,但「已到手的那件怎么变强」仍全在客户端:
 *     · 强化 `Math.random() < rate` —— 改一行就是必成,等级直冲上限;
 *     · 重铸的条数/词条/roll 全客户端掷 —— 洗出任意「完美组合」;
 *     · 词条转移虽无随机,但能把伪造出来的词条搬到主武器上。
 *   于是「合法上限内的神装」换个入口又回来了。这里把决定权收回服务端:
 *     客户端(登录)只发请求,服务端无头水合云档 → 跑**纯账层**(core/forge 的 upgradeOnce、
 *     core/reforge 的 reforgeOnce/autoReforge、core/affixTransfer 的 transferOnce)→
 *     返回变更的整件与「这次该付多少」;
 *     客户端(未登录离线)与全部单测走同一条本地链,行为与联网逐字段一致。
 *
 * 两件事分得很清:
 *   · **掷点与改件**只在这里(经纯账层)—— 结果只有一份,客户端自报不作数;
 *   · **材料消耗**由调用方记账(服务端记 pendingSpend,上传时从资源增量里扣),
 *     与坊市成交同一套机制(见 server/src/marketLedger.ts)。
 *
 * 本模块在 Node 下运行(服务端经 server/src/routes/forge.ts 动态加载),
 * 不得 import 浏览器专属链路(audio / services/cloud / DOM 组件);store 在无窗环境安全。
 */
import { createPinia, setActivePinia } from 'pinia'
import type { EquipmentInstance, GNum } from '@/types'
import { add, gn, gnZero, gt } from '@/utils/gnum'
import { MAX_MAJOR } from '@/data/realms'
import { SUB_LEVELS } from '@/data/constants'
import { affixDef } from '@/data/affixes'
import { upgradeOnce, upgradeShort, equipUpgradeQuote, equipSweepPlan, type UpgradeOutcome } from './forge'
import { autoReforge, autoReforgeBudget, reforgeOnce, type AutoReforgeOutcome, type ReforgeTarget } from './reforge'
import { transferOnce, type TransferRequest } from './affixTransfer'
// 采信余额的天花板沿用上传裁决那把尺(1.66.1):持有上限只有一份定义,不在这里另设常数
import { expHoldCap, holdCapOf } from './saveAuthority'
import { usePlayerStore } from '@/stores/player'
import { useResourcesStore } from '@/stores/resources'
import { useInventoryStore } from '@/stores/inventory'
import { useDongfuStore } from '@/stores/dongfu'
import { useLoreStore } from '@/stores/lore'
import { useCultivationStore } from '@/stores/cultivation'

/** 一次炼器动作;与 POST /api/forge/op 的 body 一一对应 */
export type ForgeOp =
  | { op: 'upgrade'; uid: string; times: number }
  | { op: 'reforge'; uid: string }
  | { op: 'autoReforge'; uid: string; targets: ReforgeTarget[]; maxRolls: number }
  | { op: 'transfer'; req: TransferRequest }
  /** 一键强化:身上已装备的按部位顺序各掷一次(队列由服务端按水合后的行囊现算) */
  | { op: 'sweep' }

/** 单次强化最多连掷几次(与批量强化按余额算出的上限同量级,再宽一格) */
export const FORGE_TIMES_MAX = 200
/** 词条转移目标列表上限:自动重铸最多盯 3 条(见 AUTO_REFORGE_MAX_TARGETS),留余量 */
export const FORGE_TARGETS_MAX = 8

/** 这次动作该付的三样;调用方据此记账(服务端记 pendingSpend) */
export interface ForgeSpend {
  stone: GNum
  dust: number
  exp: GNum
}

/** 给客户端出提示用的一次动作结果 */
export type ForgeDetail =
  | {
      kind: 'upgrade'
      /** 最后一次的结果;times 次全成时也是 'up' */
      outcome: UpgradeOutcome
      /** 未动的原因 */
      block?: 'dust' | 'exp' | 'stone' | 'cap'
      levelBefore: number
      levelAfter: number
      /** 实际掷了几次(失手即停) */
      tries: number
    }
  | { kind: 'reforge'; outcome: 'done' | 'empty' | 'short' | 'gone'; countBefore: number; countAfter: number; short?: 'stone' | 'dust' }
  | { kind: 'autoReforge'; auto: AutoReforgeOutcome }
  | { kind: 'transfer'; ok: boolean; block?: string; short?: 'stone' | 'dust' | null }
  | {
      kind: 'sweep'
      /** 真的掷了几件 */
      tried: number
      /** 掷出 +1 的件数 */
      ups: number
      /** 失手的件数 */
      fails: number
      /** 满级跳过不掷的件数 */
      capped: number
      /** 因缺料停手的那一槽;null = 一路走到底 */
      stoppedAt: string | null
      short: 'dust' | 'exp' | 'stone' | null
      gap: { dust: number; exp: GNum; stone: GNum }
    }

export interface ForgeResult {
  ok: boolean
  /** ok=false 的拒因(机读键,客户端映射成文案) */
  reason: string
  op: ForgeOp['op']
  /** 变更后的整件(客户端 replaceItem;转移会给两件) */
  items: EquipmentInstance[]
  /** 这次该付的三样 */
  spend: ForgeSpend
  detail: ForgeDetail
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

/** 读 GNum;形态非法返回 null(不在这里造值) */
function gnumOf(v: unknown): GNum | null {
  if (!isPlainObject(v)) return null
  const m = numOr(v.m, Number.NaN)
  const e = numOr(v.e, Number.NaN)
  if (!Number.isFinite(m) || !Number.isFinite(e)) return null
  return { m, e }
}

function emptySpend(): ForgeSpend {
  return { stone: gnZero(), dust: 0, exp: gnZero() }
}

/** 校验并收口一次炼器申请;形状不对返回 null(调用方拒绝结算) */
export function parseForgeOp(raw: unknown): ForgeOp | null {
  if (!isPlainObject(raw)) return null
  // 这两个动作的「主键」不在顶层 uid 上:一键强化的队列由服务端现算,转移有两件
  if (raw.op === 'sweep') return { op: 'sweep' }
  if (raw.op === 'transfer') {
    const req = isPlainObject(raw.req) ? raw.req : null
    if (req === null) return null
    const sourceUid = strOr(req.sourceUid)
    const targetUid = strOr(req.targetUid)
    const affixId = strOr(req.affixId)
    if (sourceUid === '' || targetUid === '' || affixId === '') return null
    if (sourceUid.length > 64 || targetUid.length > 64 || affixId.length > 64) return null
    // replaceId 为 null = 新增;其余必须是字符串
    const replaceId = req.replaceId === null || req.replaceId === undefined ? null : strOr(req.replaceId)
    if (replaceId !== null && (replaceId === '' || replaceId.length > 64)) return null
    return { op: 'transfer', req: { sourceUid, targetUid, affixId, replaceId, seal: req.seal === true } }
  }
  const uid = strOr(raw.uid)
  if (uid === '' || uid.length > 64) return null
  switch (raw.op) {
    case 'upgrade':
      // 次数缺省按 1;非整数/负数一律夹进 [1, FORGE_TIMES_MAX]
      return { op: 'upgrade', uid, times: Math.min(FORGE_TIMES_MAX, Math.max(1, Math.trunc(numOr(raw.times, 1)))) }
    case 'reforge':
      return { op: 'reforge', uid }
    case 'autoReforge': {
      // 目标词条是「收手条件」,不是权威数据 —— 只校验 id 确有其词、roll 落在 [0,1]
      const targets: ReforgeTarget[] = []
      for (const t of (Array.isArray(raw.targets) ? raw.targets : []).slice(0, FORGE_TARGETS_MAX)) {
        if (!isPlainObject(t)) continue
        const affixId = strOr(t.affixId)
        if (affixDef(affixId) === undefined) continue
        const minRoll = typeof t.minRoll === 'number' && Number.isFinite(t.minRoll) ? Math.min(1, Math.max(0, t.minRoll)) : undefined
        const one: ReforgeTarget = minRoll === undefined ? { affixId } : { affixId, minRoll }
        if (!targets.some(x => x.affixId === affixId)) targets.push(one)
      }
      return { op: 'autoReforge', uid, targets, maxRolls: autoReforgeBudget(numOr(raw.maxRolls, 1)) }
    }
    default:
      return null
  }
}

/* ---------------- 在「当前已激活的 store」上结算 ---------------- */

/** 逐件对比水合前后的行囊,挑出被改动的整件(按 uid 认,顺序随 after) */
function diffItems(before: readonly EquipmentInstance[], after: readonly EquipmentInstance[]): EquipmentInstance[] {
  const prev = new Map(before.map(it => [it.uid, JSON.stringify(it)]))
  return after.filter(it => prev.get(it.uid) !== JSON.stringify(it))
}

/**
 * 在当前已激活的 store 上结算一次炼器动作。
 * 客户端离线结算与服务端权威结算共用的唯一实现;被拒不改一件、不扣一样。
 */
export function resolveForgeOnStores(op: ForgeOp): ForgeResult {
  const inventory = useInventoryStore()
  const before = inventory.items.slice()

  if (op.op === 'upgrade') {
    const first = inventory.findItem(op.uid)
    const levelBefore = first?.level ?? 0
    if (!first) {
      return {
        ok: false,
        reason: 'gone',
        op: 'upgrade',
        items: [],
        spend: emptySpend(),
        detail: { kind: 'upgrade', outcome: 'blocked', block: 'cap', levelBefore, levelAfter: levelBefore, tries: 0 }
      }
    }
    // 首次就付不起(缺料/满级):一次都不掷
    const probe = equipUpgradeQuote(op.uid)
    if (probe === null) {
      return {
        ok: false,
        reason: 'cap',
        op: 'upgrade',
        items: [],
        spend: emptySpend(),
        detail: { kind: 'upgrade', outcome: 'blocked', block: 'cap', levelBefore, levelAfter: levelBefore, tries: 0 }
      }
    }
    const probeShort = upgradeShort(probe)
    if (probeShort !== null) {
      return {
        ok: false,
        reason: probeShort,
        op: 'upgrade',
        items: [],
        spend: emptySpend(),
        detail: {
          kind: 'upgrade',
          outcome: 'blocked',
          block: probeShort,
          levelBefore,
          levelAfter: levelBefore,
          tries: 0
        }
      }
    }

    const spend = emptySpend()
    let tries = 0
    let last: UpgradeOutcome = 'up'
    let block: 'dust' | 'exp' | 'stone' | 'cap' | undefined
    for (let i = 0; i < op.times; i += 1) {
      const run = upgradeOnce(op.uid)
      if (run.spent === null) {
        block = run.block
        break
      }
      tries += 1
      last = run.outcome
      spend.dust += run.spent.dust
      spend.stone = add(spend.stone, run.spent.stone)
      spend.exp = add(spend.exp, run.spent.exp)
      // 与客户端的「失手即停」同规:一次失手就不再往下掷
      if (run.outcome !== 'up') break
    }
    const levelAfter = inventory.findItem(op.uid)?.level ?? levelBefore
    return {
      ok: true,
      reason: '',
      op: 'upgrade',
      items: diffItems(before, inventory.items),
      spend,
      detail: { kind: 'upgrade', outcome: last, block, levelBefore, levelAfter, tries }
    }
  }

  if (op.op === 'reforge') {
    const run = reforgeOnce(op.uid)
    const spend = emptySpend()
    if (run.spent !== null) {
      spend.stone = run.spent.stone
      spend.dust = run.spent.dust
    }
    return {
      ok: run.outcome === 'done',
      reason: run.outcome,
      op: 'reforge',
      items: diffItems(before, inventory.items),
      spend,
      detail: {
        kind: 'reforge',
        outcome: run.outcome,
        countBefore: run.countBefore,
        countAfter: run.countAfter,
        short: run.short
      }
    }
  }

  if (op.op === 'autoReforge') {
    const out = autoReforge(op.uid, op.targets, op.maxRolls)
    return {
      ok: out.rolls > 0,
      reason: out.stop,
      op: 'autoReforge',
      items: diffItems(before, inventory.items),
      spend: { stone: out.stone, dust: out.dust, exp: gnZero() },
      detail: { kind: 'autoReforge', auto: out }
    }
  }

  if (op.op === 'sweep') {
    const plan = equipSweepPlan()
    const spend = emptySpend()
    let tried = 0
    let ups = 0
    let fails = 0
    for (const slot of plan.queue) {
      const uid = inventory.equipped[slot]
      if (!uid) continue
      const run = upgradeOnce(uid)
      // 计划刚验过账,理论不至此;真被拦就停手,不硬扣(与客户端同规)
      if (run.spent === null) break
      spend.dust += run.spent.dust
      spend.stone = add(spend.stone, run.spent.stone)
      spend.exp = add(spend.exp, run.spent.exp)
      tried += 1
      if (run.outcome === 'up') ups += 1
      else fails += 1
    }
    return {
      ok: tried > 0,
      // 一件都没掷:有缺料就报缺的那一样,否则是「全满级 / 身上没装备」
      reason: tried > 0 ? '' : (plan.short ?? 'nothing'),
      op: 'sweep',
      items: diffItems(before, inventory.items),
      spend,
      detail: {
        kind: 'sweep',
        tried,
        ups,
        fails,
        capped: plan.capped,
        stoppedAt: plan.stoppedAt,
        short: plan.short,
        gap: plan.gap
      }
    }
  }

  const run = transferOnce(op.req)
  if (!run.ok) {
    return {
      ok: false,
      reason: run.block,
      op: 'transfer',
      items: [],
      spend: emptySpend(),
      detail: { kind: 'transfer', ok: false, block: run.block, short: run.short ?? null }
    }
  }
  return {
    ok: true,
    reason: '',
    op: 'transfer',
    items: diffItems(before, inventory.items),
    spend: { stone: run.cost.stone, dust: run.cost.dust, exp: gnZero() },
    detail: { kind: 'transfer', ok: true }
  }
}

/* ---------------- 服务端入口:从存档分片无头结算 ---------------- */

/**
 * 客户端上报的余额;服务端取「云档值」与「上报值」的较大者,但上报值先按本境界的持有上限截断。
 * 允许高于云档是为了不误报「缺料」(本地刚拾到的东西还没上传),上限则拦住「填个天文数字当钱花」。
 */
export interface ForgeClaims {
  exp?: unknown
  dust?: unknown
  stone?: unknown
}

/** 水合时要铺开的分片:炼器会读装备、材料、修为、洞府强化上限与技艺 */
const HYDRATED_SLICES = ['inventory', 'resources', 'cultivation', 'dongfu', 'lore'] as const

/**
 * 从云档分片无头结算一次炼器(服务端走这条):
 * 临时 pinia 水合 → 采信不低于云档的上报余额 → 同一套裁决代码掷点 → 返回变更件与应扣账。
 * 形状门槛(game 未开局 / uid 非法)返回 null,调用方拒绝结算。
 */
export function resolveForgeFromSlices(data: unknown, rawOp: unknown, claims: ForgeClaims = {}): ForgeResult | null {
  if (!isPlainObject(data)) return null
  const game = isPlainObject(data.game) ? data.game : {}
  if (game.started !== true) return null
  const op = parseForgeOp(rawOp)
  if (op === null) return null

  const pinia = createPinia()
  setActivePinia(pinia)
  try {
    const stores: Record<string, { $patch: (p: unknown) => void }> = {
      inventory: useInventoryStore() as never,
      resources: useResourcesStore() as never,
      cultivation: useCultivationStore() as never,
      dongfu: useDongfuStore() as never,
      lore: useLoreStore() as never
    }
    const playerSlice = isPlainObject(data.player) ? data.player : null
    if (playerSlice === null || !Number.isFinite(playerSlice.major)) return null
    usePlayerStore().$patch(playerSlice as never)
    for (const id of HYDRATED_SLICES) {
      const slice = data[id]
      if (isPlainObject(slice)) stores[id]!.$patch(slice)
    }

    /*
     * 余额只采「不低于云档」的上报值:
     * 客户端本地往往比云档新(刚拾到的器灵尘还没上传),不采信就会误报「缺料」。
     * 但采信必须有天花板(1.66.1):此前只验「是有限数」,改包填个 1e30 就能拿根本不存在的
     * 资源炼器 —— 花费只记进 pendingSpend,到下次上传才从资源增量里扣,扣不满等于部分免费。
     * 天花板取上传裁决那把尺(core/saveAuthority 的持有上限):正常玩家的余额本来就压在这条线以下,
     * 不误伤;而「未来资源」最多也就预支一档持有上限,与存档裁决同口径。
     * 只压上报值,不回压云档 —— 云档超限是上传裁决的活,这里再改一次会让两条链互相拆台。
     */
    const player = usePlayerStore()
    const resources = useResourcesStore()
    const major = Math.trunc(Math.min(Math.max(numOr(player.major, 0), 0), MAX_MAJOR))
    const sub = Math.trunc(Math.min(Math.max(numOr(player.sub, 0), 0), SUB_LEVELS - 1))
    const expCeil = expHoldCap(major, sub)
    const claimExp = gnumOf(claims.exp)
    if (claimExp !== null) {
      const claim = gt(claimExp, expCeil) ? expCeil : claimExp
      if (gt(claim, player.exp)) player.exp = { ...claim }
    }
    const dustCeil = holdCapOf(major, 'dust')
    if (typeof claims.dust === 'number' && Number.isFinite(claims.dust)) {
      const raw = Math.max(0, Math.trunc(claims.dust))
      // 上限为 0 表示「模型给不出产出」:此时不设限(与上传裁决同一处理,不拿 0 把余额清零)
      const claim = dustCeil > 0 ? Math.min(raw, Math.floor(dustCeil)) : raw
      if (claim > resources.dust) resources.dust = claim
    }
    const stoneCeil = holdCapOf(major, 'stone')
    const claimStone = gnumOf(claims.stone)
    if (claimStone !== null) {
      const claim = stoneCeil > 0 && gt(claimStone, gn(stoneCeil)) ? gn(stoneCeil) : claimStone
      if (gt(claim, resources.spiritStone)) resources.spiritStone = { ...claim }
    }

    return resolveForgeOnStores(op)
  } catch {
    return null
  } finally {
    setActivePinia(undefined)
  }
}

/*
 * 一件装备的「权威状态」为 level / affixes / sealedAffixIds / reforgeCount / transferCount / invested
 * 这六个字段。模板、品质、阶数由签发时确定,不重复保管;装备/卸下、上锁这类不改变强度的操作也不走台账。
 * 服务端按这组字段写 equip_state、上传时按同一组字段覆盖(见 server/src/equipLedger.ts)。
 */
