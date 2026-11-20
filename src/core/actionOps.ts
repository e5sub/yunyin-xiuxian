/**
 * 动作结算的服务端权威入口(1.78.0) —— 「客户端点一下」这件事由服务端说了算。
 *
 * 为什么要有这个模块:
 *   1.77.0 之前,玩家主动触发的动作用全在客户端跑(吃丹、炼丹、际遇选择、熔炉、
 *   秘境、分解、卖出、兑换、穿脱、点星…),服务端只在 PUT /save 时事后钳制。
 *   钳制的本质是「允许一部分增量」,于是控制台改 store 后分几次上传,
 *   每一段都落在窗口余量内 —— 慢慢堆也能堆出改包的效果。
 *
 *   本模块把「执行」搬到服务端:水合云档 → 跑**客户端同一份结算代码** → 取键级 diff。
 *   没有第二套逻辑,所以不会漂移;也不需要重写任何玩法。
 *
 * 与 advanceResolve 的分工:
 *   - advanceResolve:时间推进(修为/灵气/洞府/历练节拍/离线),客户端只发心跳;
 *   - actionOps:离散动作(玩家点出来的那一下),客户端发动作 + 参数。
 *
 * 纪律:
 *   - 本模块只改 store,不碰 DOM/音频;audio 与 ui 都有环境守卫,无头下静默。
 *   - 动作合法性一律由被调用的那份代码判定(资源不够、境界不够、材料不够),这里不另设门槛 ——
 *     否则同一个「能不能吃」会出现两套判据。
 *   - 失败(返回 false / null / 0)时**不回任何补丁**:客户端本地那一次预测必须整体作废。
 *
 * 运行在 Node(服务端经 vendor 加载,见 scripts/build-vendor.mjs)。
 */
import { createPinia, setActivePinia } from 'pinia'
import { usePlayerStore } from '@/stores/player'
import { useInventoryStore } from '@/stores/inventory'
import { useCultivationStore } from '@/stores/cultivation'
import { useMarketStore } from '@/stores/market'
import { useApprenticeStore } from '@/stores/apprentice'
import { useAdventureStore } from '@/stores/adventure'
import { SLICE_FACTORIES, diffSlices, hydrationNoise, isPlainObject, stateClone } from './sliceStores'
import { usePill, usePillBatch, craftPill, craftPillBatch } from './pillService'
import { condenseDaoFruit, furnaceConvert, furnaceConvertStone, challengeTrial } from './endgameService'
import { abandonRealm, enterSecretRealm, fightSecretLayer } from './secretRealm'
import { decomposeBatch, decomposeEquipment } from './forge'
import { resolveEventChoice } from './eventEngine'
import { askDivination } from './divinationService'
import { refineEquipment, removeSoul, wearSoul, dissolveSoul } from './soulService'
import { eventDef } from '@/data/events'
import { FURNACE_RATES } from '@/data/endgame'
import type { HerbGrade } from '@/data/herbGrades'

/** 动作请求:kind 决定走哪条结算,其余字段是该动作的参数(形状由分支自己验) */
export interface ActionRequest {
  kind: string
  /** 丹药 id / 装备 uid / 功法 id / 称号 id / 星名 / 世界 id / 秘境 id / 档案 id */
  id?: unknown
  /** 第二个 id(功法分支、灵脉目标等) */
  id2?: unknown
  /** 次数(批量服丹/连炼/兑换) */
  count?: unknown
  /** 选项下标(顿悟 / 巡游 / 际遇) */
  index?: unknown
  /** 批量 uid(分解) */
  ids?: unknown
  /** 熔炼档位 */
  rate?: unknown
  /** 装备槽 */
  slot?: unknown
  /** 灵草品阶 */
  grade?: unknown
}

export interface ActionResult {
  ok: boolean
  reason?: string
  /** 被动作改动的字段(分片 → 顶层键) */
  patches: Record<string, Record<string, unknown>>
  /** 动作自身的返回值(战斗结果 / 产出清单),给客户端做提示 */
  payload?: unknown
}

export interface ActionCtx {
  /** 服务端时刻(不采信客户端时钟) */
  now: number
}

function numOf(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function strOf(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/** 整数参数:缺省/非法按 def 兜,并钳在 [lo, hi] */
function intOf(v: unknown, def: number, lo: number, hi: number): number {
  const n = Math.trunc(numOf(v))
  if (!Number.isFinite(n) || n === 0) return def
  return Math.min(Math.max(n, lo), hi)
}

function fail(reason: string): ActionResult {
  return { ok: false, reason, patches: {} }
}

/**
 * 水合云档分片到临时 pinia。调用方负责 setActivePinia(见 resolveActionFromSlices)。
 * 只 patch 有形状的分片:缺片按 store 默认值,与客户端首次读档后的状态一致。
 */
function hydrate(data: Record<string, unknown>): void {
  for (const [id, factory] of SLICE_FACTORIES) {
    const slice = data[id]
    if (isPlainObject(slice)) factory().$patch(slice)
  }
}

/** 动作分支:返回 ok=false 即整体作废(不回补丁);payload 原样回给客户端 */
async function runAction(req: ActionRequest): Promise<ActionResult> {
  const player = usePlayerStore()
  const inventory = useInventoryStore()
  const cultivation = useCultivationStore()
  const market = useMarketStore()
  const apprentice = useApprenticeStore()
  const adventure = useAdventureStore()
  const id = strOf(req.id)

  switch (req.kind) {
    /* ---------------- 丹药 ---------------- */
    case 'pill_use': {
      const count = intOf(req.count, 1, 1, 999)
      if (count === 1) return (await usePill(id, true)) ? { ok: true, patches: {} } : fail('服丹失败')
      const eaten = usePillBatch(id, count)
      return eaten > 0 ? { ok: true, patches: {}, payload: { eaten } } : fail('囊中无此丹')
    }
    case 'pill_craft': {
      const count = intOf(req.count, 1, 1, 99)
      if (count === 1) {
        const out = craftPill(id, true)
        if (out.aborted === true) return fail('炼不动')
        return { ok: true, patches: {}, payload: out }
      }
      const out = craftPillBatch(id, count)
      if (out.rounds === 0) return fail('炼不动')
      return { ok: true, patches: {}, payload: out }
    }

    /* ---------------- 早游戏事件 ---------------- */
    /*
     * 顿悟与洞府巡游不在这里:它们的事件本体存在 earlyGameService 的模块级变量里,
     * 无头环境不存在,服务端调进来只会 no-op。这两条走「客户端生成 + 产出走专用端点」,
     * 见 core/earlyGameService 的 reward 上报口(后续批次)。
     */

    /* ---------------- 道源 / 熔炉 / 试炼 ---------------- */
    case 'furnace': {
      // 档位只认资源名(唯一):服务端按自己的数据表取 per,不采信客户端报的兑换率
      const resource = strOf(req.rate)
      const rate = FURNACE_RATES.find(r => r.resource === resource)
      if (rate === undefined) return fail('没有这档熔炼')
      const gained = furnaceConvert(rate)
      if (gained <= 0) return fail('熔不出来')
      return { ok: true, patches: {}, payload: { daoSource: gained } }
    }
    case 'furnace_stone': {
      const n = intOf(req.count, 1, 1, 999)
      return furnaceConvertStone(n) ? { ok: true, patches: {}, payload: { times: n } } : fail('灵石不足')
    }
    case 'dao_fruit': {
      const n = intOf(req.count, 1, 1, 999)
      return condenseDaoFruit(n) ? { ok: true, patches: {}, payload: { times: n } } : fail('未达凝果之期')
    }
    case 'trial': {
      const out = challengeTrial(id)
      return out === null ? fail('此试炼不可挑战') : { ok: true, patches: {}, payload: out }
    }

    /* ---------------- 秘境 ---------------- */
    case 'secret_enter': {
      const out = enterSecretRealm(id)
      return out.ok === true ? { ok: true, patches: {}, payload: out } : fail('入不得此境')
    }
    case 'secret_fight': {
      const out = await fightSecretLayer()
      return out === null ? fail('此层已了') : { ok: true, patches: {}, payload: out }
    }
    case 'secret_exit': {
      abandonRealm()
      return { ok: true, patches: {} }
    }

    /* ---------------- 分解 ---------------- */
    case 'salvage': {
      if (Array.isArray(req.ids) && req.ids.length > 0) {
        const uids = req.ids.filter((x): x is string => typeof x === 'string')
        const items = inventory.bagItems.filter(it => uids.includes(it.uid))
        if (items.length === 0) return fail('没有可分解之物')
        const out = decomposeBatch(items)
        return { ok: true, patches: {}, payload: out }
      }
      if (id === '') return fail('缺少装备')
      return decomposeEquipment(id, { quiet: true }) ? { ok: true, patches: {} } : fail('分解失败')
    }

    /* ---------------- 坊市卖出 ---------------- */
    case 'sell_pill': {
      const n = intOf(req.count, 1, 1, 999)
      if (n > 1) {
        const out = market.sellPillAll(id)
        return out.count > 0 ? { ok: true, patches: {}, payload: out } : fail('囊中无此丹')
      }
      return market.sellPill(id) ? { ok: true, patches: {} } : fail('囊中无此丹')
    }
    case 'sell_material': {
      return market.sellMaterial(player.major) ? { ok: true, patches: {} } : fail('玄铁不足')
    }
    case 'sell_herb': {
      const grade = strOf(req.grade) as unknown as HerbGrade
      return market.sellHerb(grade) ? { ok: true, patches: {} } : fail('灵草不足')
    }
    case 'sell_all_herb': {
      const grade = strOf(req.grade) as unknown as HerbGrade
      const n = market.sellHerbAll(grade)
      return n > 0 ? { ok: true, patches: {}, payload: { count: n } } : fail('灵草不足')
    }
    case 'sell_all_ore': {
      const n = market.sellOreAll(player.major)
      return n > 0 ? { ok: true, patches: {}, payload: { count: n } } : fail('玄铁不足')
    }

    /* ---------------- 灵石 → 悟道 ---------------- */
    case 'wudao_exchange': {
      const n = intOf(req.count, 1, 1, 99)
      const done = player.exchangeStoneForWudaoBatch(n)
      return done > 0 ? { ok: true, patches: {}, payload: { times: done } } : fail('灵石不足或今日已尽')
    }

    /* ---------------- 装配 ---------------- */
    case 'equip': {
      const slot = strOf(req.slot)
      if (slot === '') return fail('缺少槽位')
      return inventory.equip(id, slot as Parameters<typeof inventory.equip>[1])
        ? { ok: true, patches: {} }
        : fail('装不上')
    }
    case 'unequip': {
      const slot = strOf(req.slot)
      if (slot === '') return fail('缺少槽位')
      inventory.unequip(slot as Parameters<typeof inventory.unequip>[0])
      return { ok: true, patches: {} }
    }
    case 'artifact_toggle': {
      const maxSlots = Math.max(1, Math.trunc(numOf(req.count)) || 1)
      const out = inventory.toggleArtifact(id, maxSlots)
      return out === 'rejected' ? fail('法宝格已满') : { ok: true, patches: {}, payload: out }
    }
    case 'gongfa_equip_main': {
      return cultivation.equipMain(id) ? { ok: true, patches: {} } : fail('装配失败')
    }
    case 'gongfa_toggle_sub': {
      const maxSlots = Math.max(0, Math.trunc(numOf(req.count)))
      return cultivation.toggleSub(id, maxSlots) ? { ok: true, patches: {} } : fail('副席已满')
    }
    case 'gongfa_branch': {
      const branch = strOf(req.id2)
      return cultivation.chooseBranch(id, branch) ? { ok: true, patches: {} } : fail('此路不通')
    }

    /* ---------------- 称号 / 星象 / 问卦 ---------------- */
    case 'title': {
      player.setTitle(id === '' ? null : id)
      return { ok: true, patches: {} }
    }
    case 'fate_focus': {
      return player.focusFateStar(id) ? { ok: true, patches: {} } : fail('点不了这颗星')
    }
    case 'fate_redirect': {
      return player.redirectFavoredWorld(id as Parameters<typeof player.redirectFavoredWorld>[0])
        ? { ok: true, patches: {} }
        : fail('改不了命途')
    }
    case 'divination': {
      // 卦象由服务端掷:客户端只发「我要问卦」,卦与代价都在这一侧定
      const out = askDivination()
      return out.ok ? { ok: true, patches: {}, payload: out } : fail(out.reason ?? '卜不出来')
    }

    /* ---------------- 器魂 ---------------- */
    case 'soul_refine': {
      return (await refineEquipment(id)) ? { ok: true, patches: {} } : fail('凝不出魂')
    }
    case 'soul_equip': {
      return wearSoul(id) ? { ok: true, patches: {} } : fail('佩不上')
    }
    case 'soul_unequip': {
      removeSoul(id)
      return { ok: true, patches: {} }
    }
    case 'soul_dissolve': {
      dissolveSoul(id)
      return { ok: true, patches: {} }
    }

    /* ---------------- 弟子 ---------------- */
    case 'apprentice_recruit': {
      const out = apprentice.recruit(player.major)
      if (out === 'full') return fail('道童已满')
      if (out === 'poor') return fail('灵石不足')
      return { ok: true, patches: {} }
    }

    /* ---------------- 际遇选择 ---------------- */
    case 'event_choice': {
      const pendingId = adventure.pendingEventId
      if (typeof pendingId !== 'string' || pendingId === '') return fail('此刻没有际遇')
      const def = eventDef(pendingId)
      if (!def) return fail('没有这场际遇')
      const idx = intOf(req.index, 0, 0, Math.max(0, def.choices.length - 1))
      const tier = Math.max(0, Math.trunc(player.major))
      const out = await resolveEventChoice(def, idx, tier)
      adventure.setPendingEvent(null, 0)
      return { ok: true, patches: {}, payload: out }
    }

    default:
      return fail('未知动作')
  }
}

/**
 * 在云档分片上执行一个动作,返回键级补丁。
 *
 * 分片形状不合法(未开局 / player 缺境界)或链路抛错返回 null,调用方据此拒绝;
 * 动作本身失败(资源不够等)返回 ok=false + 空补丁 —— 两者要分开:前者是服务端事故,后者是玩家的正常反馈。
 */
export async function resolveActionFromSlices(
  data: unknown,
  req: ActionRequest,
  ctx: ActionCtx
): Promise<ActionResult | null> {
  if (!isPlainObject(data)) return null
  const raw = data as Record<string, unknown>
  const game = isPlainObject(raw.game) ? raw.game : {}
  if (game.started !== true) return null
  const playerSlice = isPlainObject(raw.player) ? raw.player : null
  if (playerSlice === null || !Number.isFinite(playerSlice.major) || !Number.isFinite(playerSlice.sub)) return null
  if (!Number.isFinite(ctx.now) || ctx.now <= 0) return null
  if (typeof req.kind !== 'string' || req.kind === '') return null

  const pinia = createPinia()
  setActivePinia(pinia)
  try {
    hydrate(raw)
    /*
     * 水合噪声:store 的 sanitize / 默认值填充会在「什么都没做」时也改动若干键。
     * 空跑取两次快照把它们挑出来,diff 时排除 —— 否则每个动作都会回传一堆无关字段。
     */
    const noise = hydrationNoise()
    const before = stateClone()
    const result = await runAction(req)
    if (!result.ok) return result
    const after = stateClone()
    return { ...result, patches: diffSlices(before, after, noise) }
  } catch (e) {
    return fail(e instanceof Error ? e.message : '结算失败')
  } finally {
    setActivePinia(undefined)
  }
}
