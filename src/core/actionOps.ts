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
import { checkAchievements, checkStateAchievements } from './progress'
import { usePill, usePillBatch, craftPill, craftPillBatch } from './pillService'
import { condenseDaoFruit, furnaceConvert, furnaceConvertStone, challengeTrial } from './endgameService'
import { abandonRealm, enterSecretRealm, fightSecretLayer } from './secretRealm'
import { gongfaDef } from '@/data/gongfa'
import { decomposeBatch, decomposeEquipment } from './forge'
import { resolveEventChoice } from './eventEngine'
import { askDivination } from './divinationService'
import { chooseEnlightenment, chooseCaveOption, dismissEnlightenment, dismissCaveEvent, getCurrentEnlightenment, getCurrentCaveEvent } from './earlyGameService'
import {
  prepareReincarnationLocal,
  rerollReincarnationLinggenLocal,
  confirmReincarnationLocal
} from './reincarnation'
import { refineEquipment, removeSoul, wearSoul, dissolveSoul } from './soulService'
import { eventDef } from '@/data/events'
import {
  startWorldExpedition,
  chooseRouteNode,
  challengeGuardian,
  autoAdvanceExpedition,
  abandonExpedition,
  challengeMutation,
  rerollVoidWorld,
  canAutoExpedition,
  noteAutoExpedition
} from './expedition'
import { undertakeChallenge, verifyChallenge, type ChallengeDraft } from './challenge'
import { todayChallenge, undertakeDaily } from './dailyChallenge'
import { apprenticeSpoils, taskDone } from './apprenticeService'
import { APPRENTICE_MAX_LEVEL } from '@/data/apprentices'
import { gameNow } from './enginePause'
import { FURNACE_RATES } from '@/data/endgame'
import { MARKET_REFRESH_SECONDS, MARKET_SLOTS } from '@/data/market'
import { isHerbGrade } from '@/data/herbGrades'

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
  /** 整张装配映射(equip_set:一键换装连换数件时带齐全部槽位) */
  equipped?: unknown
  /** 灵草品阶 */
  grade?: unknown
  /** 远征契约 id(null 表示不立契) */
  pact?: unknown
  /** 远征界门 id */
  gate?: unknown
  /** 试炼题面(自建挑战) */
  draft?: unknown
  /** 坊市货架上货时刻(与云档里的 stockedAt 核对,过期即不成交) */
  at?: unknown
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

/** 可空字符串参数:非串/空串一律 null */
function strOrNull(v: unknown): string | null {
  const s = strOf(v)
  return s === '' ? null : s
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

    /* ---------------- 早游戏事件(1.79.0 事件本体已进档) ---------------- */
    case 'enlighten': {
      const idx = intOf(req.index, 0, 0, 3)
      // 无待选顿悟时 chooseEnlightenment 自己会 no-op:以「窗是否还开着」判成败
      const had = getCurrentEnlightenment() !== null
      chooseEnlightenment(idx)
      return had ? { ok: true, patches: {} } : fail('此刻没有顿悟')
    }
    case 'enlighten_dismiss': {
      dismissEnlightenment()
      return { ok: true, patches: {} }
    }
    case 'cave_choice': {
      const idx = intOf(req.index, 0, 0, 3)
      const had = getCurrentCaveEvent() !== null
      chooseCaveOption(idx)
      return had ? { ok: true, patches: {} } : fail('此刻没有洞府际遇')
    }
    case 'cave_dismiss': {
      dismissCaveEvent()
      return { ok: true, patches: {} }
    }

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
      /*
       * 灵草品阶是数字 1..5(HerbGrade),客户端 reportAction('sell_herb',{grade:1}) 传的就是数字。
       * 曾误用 strOf 取值:数字 1 被转成 '' → sellHerb('') 永远卖不出 → ok=false → 客户端
       * resync 整档覆盖,本地已扣的货/加的钱被打回,表现为「卖不出去」(1.79.4)。
       */
      const g = numOf(req.grade)
      if (!isHerbGrade(g)) return fail('灵草不足')
      return market.sellHerb(g) ? { ok: true, patches: {} } : fail('灵草不足')
    }
    case 'sell_all_herb': {
      const g = numOf(req.grade)
      if (!isHerbGrade(g)) return fail('灵草不足')
      const n = market.sellHerbAll(g)
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
    case 'equip_set': {
      /*
       * 整张装配映射:客户端一键换装/穿脱后带齐全部槽位上报。逐槽位过 canEquip
       * (门槛/持有判定与单件 equip 同源),服务端在云档上裁决,非法项一律丢弃。
       * 不采信「只报一槽」——那样撞 250ms 限速丢一发就停在半换状态。
       */
      const raw = isPlainObject(req.equipped) ? req.equipped : {}
      const map: Record<string, string> = {}
      for (const [slot, uid] of Object.entries(raw)) {
        if (typeof uid === 'string') map[slot] = uid
      }
      inventory.equipSet(map)
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
    case 'gongfa_set_subs': {
      // 副席整份同步(1.79.18):构筑一键还原把整张 subGongfa 换掉,逐个 toggle 会撞 250ms 动作闸。
      // 校验与 toggleSub 同门:须已习得、非主修门类、不与主修同席,席面按门类各算各的。
      const rawIds = Array.isArray(req.ids) ? req.ids : []
      const ids: string[] = []
      for (const raw of rawIds) {
        const gid = strOf(raw)
        if (gid === '' || ids.includes(gid)) continue
        if (cultivation.learned[gid] === undefined) continue
        const gdef = gongfaDef(gid)
        if (!gdef || gdef.type === 'main' || gid === cultivation.mainGongfa) continue
        ids.push(gid)
      }
      cultivation.subGongfa = ids
      return { ok: true, patches: {} }
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

    /* ---------------- 坊市买入(1.79.0) ---------------- */
    /*
     * 买入原先由客户端自己「扣钱 + 入货」,服务端只记一笔 market_purchases 台账 ——
     * 抛弃存档之后,客户端那份入货根本传不上来(钱却真扣了),于是这一格买完即蒸发。
     * 现在整笔在云档上跑:扣灵石、入丹/草/铁、签发装备都在这一侧发生。
     */
    case 'market_buy': {
      const at = Math.trunc(numOf(req.at))
      const idx = Math.trunc(numOf(req.index))
      if (!Number.isFinite(at) || at <= 0) return fail('货架已换新')
      if (!Number.isFinite(idx) || idx < 0 || idx >= MARKET_SLOTS) return fail('没有这一格')
      /*
       * 1.79.4:云档的 market 分片只在首传/买入时落库,心跳不推进它 —— 起钟会停在
       * 首传那一刻。玩家本地跨过刷新窗口后 sync 换新架、报来新的 at,与云档起钟必然
       * 不等。旧版在此硬校验 at === market.stockedAt → 判「货架已换新」→ 客户端
       * resync 整档打回 → 定时器再 sync 换新 → 「买一次刷一次架」,且永远买不成。
       *
       * 货架内容由 (major, at) 确定性再生,at 只是「买哪一批货」的种子,价格/货品
       * 仍由服务端按同一把种子复算,采信它不改变任何数值。只需把 at 关在合理窗口:
       * 不早于一个刷新周期(防挑久远的种子刷特定货),不晚于服务端当前时刻(防未来钟)。
       * 随后按 at 重上同一架货再成交,云档起钟也随补丁追上,不再与本地分叉。
       */
      const refreshMs = MARKET_REFRESH_SECONDS * 1000
      const now = gameNow()
      if (at > now + 60_000 || at < now - refreshMs - 60_000) return fail('货架已换新')
      /*
       * 1.79.6:别无脑 restockAt —— 它会整架重生,把云档里先前已售的格子冲回「可买」。
       * hydrate 已把云档 market(含每格 sold)带进临时 store,上报 at 与云档起钟相同
       * 说明客户端看的就是这一架,直接在云档货架上成交,sold 标记原样保留。
       * 只有「云档还没这一架」(空架/起钟不同,即 1.79.4 的跨刷新窗口换架)才按 at 重上 ——
       * 新架本就该全是未售,与保留旧架的已售并不矛盾。
       */
      if (market.stock.length === 0 || market.stockedAt !== at) market.restockAt(at)
      /*
       * 「买不成」是正常反馈(灵石不够 / 已售出 / 行囊满),不是服务端事故 ——
       * 所以照实把结果码放在 payload 里回来,ok 仍为 true:客户端没有本地预测要作废,
       * 也就没必要为一次「灵石不足」拉整档重对齐。
       */
      const out = await market.buy(idx)
      /*
       * 成交后这一格必须留在「已售」态并随补丁回云档。正常 buy() 自己会置位,
       * 这里再钉一道:若中途换了货架种子/本地预测把格号挪走,补丁里缺了 sold,
       * 玩家一刷新就又看到「买下」,钱货两空还以为没买成(1.79.5)。
       */
      if (out === 'ok') {
        const slot = market.stock.find(s => s.idx === idx)
        if (slot !== undefined) slot.sold = true
      }
      return { ok: true, patches: {}, payload: out }
    }

    /* ---------------- 弟子 ---------------- */
    /*
     * 差事收割(1.79.0):产出原先由客户端 `applySpoils` 直接记账 ——
     * 抛弃存档之后那笔账传不上去,等于白派一趟。现在在云档上重算:
     * 道童、spec、等级、境界都取自档内,产出按同一份表复算。
     */
    case 'apprentice_claim': {
      const appr = apprentice.apprentices.find(x => x.uid === id)
      if (appr === undefined) return { ok: true, patches: {}, payload: { gone: true } }
      if (appr.task === null) return { ok: true, patches: {}, payload: { gone: true } }
      const now = gameNow()
      if (!taskDone(appr, now)) {
        return { ok: true, patches: {}, payload: { remainMs: Math.max(0, appr.task.finishAt - now) } }
      }
      const spoils = apprenticeSpoils(appr.archId, appr.task.spec, player.major, appr.level)
      apprentice.applyTaskSpoils(spoils, player.major)
      appr.level = Math.min(APPRENTICE_MAX_LEVEL, appr.level + 1)
      appr.bond += 1
      appr.task = null
      return { ok: true, patches: {}, payload: { spoils } }
    }
    case 'apprentice_recruit': {
      const out = apprentice.recruit(player.major)
      if (out === 'full') return fail('道童已满')
      if (out === 'poor') return fail('灵石不足')
      return { ok: true, patches: {} }
    }

    /* ---------------- 转世(1.79.0) ---------------- */
    /*
     * 交割单在服务端算、在服务端兑现:客户端只说「我要转世 / 我要改命 / 我确认了」。
     * 先天之姿与命题池都由这一侧掷,确认时按同一份单子入账 —— 客户端凭空的单子
     * 进不了云档,也就没得挑。
     */
    case 'rebirth_prepare': {
      const view = prepareReincarnationLocal()
      return { ok: true, patches: {}, payload: view }
    }
    case 'rebirth_reroll': {
      if (player.rebirthOffer === null) return fail('还没有交割单')
      rerollReincarnationLinggenLocal()
      return { ok: true, patches: {}, payload: player.rebirthOffer }
    }
    case 'rebirth_confirm': {
      if (player.rebirthOffer === null) return fail('还没有交割单')
      const talentId = id === '' ? null : id
      const themeId = strOf(req.id2) === '' ? null : strOf(req.id2)
      const done = await confirmReincarnationLocal(talentId, themeId)
      return done ? { ok: true, patches: {} } : fail('转世未成')
    }

    /* ---------------- 远征(1.79.0) ---------------- */
    /*
     * 远征一次就是一场战斗,而战斗的随机数只在服务端那一侧掷得作数。
     * 客户端拿到的是 `payload` 里的战果(StepOutcome),照它出战报;本地那次不跑,
     * 否则界面上会先演一遍「赢了」再被补丁改成「输了」。
     */
    case 'expedition_start': {
      const out = startWorldExpedition(id, strOrNull(req.pact), strOrNull(req.gate))
      return out === null ? fail('入不得此界') : { ok: true, patches: {}, payload: out }
    }
    case 'expedition_node': {
      const choice = intOf(req.index, 0, 0, 1) === 1 ? 1 : 0
      const out = chooseRouteNode(choice)
      return out === null ? fail('此路不通') : { ok: true, patches: {}, payload: out }
    }
    case 'expedition_guardian': {
      const out = challengeGuardian()
      return out === null ? fail('不到决战之时') : { ok: true, patches: {}, payload: out }
    }
    case 'expedition_auto': {
      /*
       * 全自动的每日次数在这里判:非 VIP 每日 EXPEDITION_AUTO_DAILY_LIMIT 次。
       * 客户端也判一次(界面上提前把按钮收掉),但那只是提示 —— 真正作数的是这一侧,
       * 否则手搓一个请求就能把「代打」变成无限。
       */
      if (!canAutoExpedition()) return fail('今日全自动次数已尽')
      const out = autoAdvanceExpedition()
      if (out === null) return fail('没有可续的远征')
      noteAutoExpedition()
      return { ok: true, patches: {}, payload: out }
    }
    case 'expedition_abandon': {
      abandonExpedition()
      return { ok: true, patches: {} }
    }
    case 'void_reroll': {
      const ok = await rerollVoidWorld()
      return ok ? { ok: true, patches: {} } : fail('道源不足')
    }

    /* ---------------- 天道变数 / 试炼之题(1.79.0) ---------------- */
    case 'mutation': {
      const ids = Array.isArray(req.ids) ? req.ids.filter((x): x is string => typeof x === 'string') : []
      const out = challengeMutation(ids)
      return out === null ? fail('开不了这一局') : { ok: true, patches: {}, payload: out }
    }
    case 'challenge': {
      const draft = req.draft
      if (!isPlainObject(draft) || typeof draft.worldId !== 'string') return fail('题面不完整')
      const shaped = draft as unknown as ChallengeDraft
      // 裁判在服务端自己跑一遍:客户端报的判决不作数(它只用来在界面上先亮个绿灯)
      const verdict = verifyChallenge(shaped)
      if (verdict === null || !verdict.ok) return fail('此题无解')
      const out = undertakeChallenge(shaped, verdict)
      return out === null ? fail('应不了这一局') : { ok: true, patches: {}, payload: out }
    }
    case 'daily_challenge': {
      // 只应「今天」这一题:日号由服务端按自己的钟取,客户端报的日子不采信
      const daily = todayChallenge()
      if (daily === null) return fail('今日无题')
      const out = undertakeDaily(daily)
      return out === null ? fail('今日已完成') : { ok: true, patches: {}, payload: out }
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
    // 动作推开的状态也可能刚好凑够某个成就(1.79.0):赏在这里发,随补丁一起回去
    checkAchievements()
    checkStateAchievements()
    const after = stateClone()
    return { ...result, patches: diffSlices(before, after, noise) }
  } catch (e) {
    return fail(e instanceof Error ? e.message : '结算失败')
  } finally {
    setActivePinia(undefined)
  }
}
