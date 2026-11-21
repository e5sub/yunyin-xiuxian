/**
 * 经济 op 端点(1.77.0):客户端自算灵石收入的统一上报口。
 *
 * 每条路径(坊市卖出/悬赏交货/洞府巡游/成就任务/连胜/秘境层)在客户端入账前先调这里;
 * 服务端按 economyOps 复算金额(客户端报的数值一律不作数),记进 stone_ledger。
 * 上传存档时灵石的可增长量 = 窗口追赶 + 台账进项(saveAuthority),没记过账的进项被钳回。
 *
 * 与 /market/buy 同一档限速;巡游/连胜/秘境另叠 loot_budgets 件数账(与掉落账同表,
 * 「上次同类结算时刻 + 真实间隔推算」的同一把尺)。
 */
import express, { type Request, type Response } from 'express'
import { get, upsertByPk } from '../db.js'
import { requireAuth } from '../auth.js'
import { loadClientModule } from '../clientVendor.js'
import { withKeyLock } from '../mutex.js'
import { recordStoneCredit, pruneStoneCredits } from '../stoneLedger.js'
import { claimedMap, recordClaim, settleClaims } from '../economyLedger.js'
import { takeLootBudget } from '../lootLedger.js'
import { gnumAdd } from '../gnumOps.js'
import { backupBeforeOverwrite } from './save.js'

const economyRouter = express.Router()

/** 客户端共享模块:运行时走 tsx paths,打包环境退 vendor(与 game.ts 同一套) */
const SOURCE_MODULE = '../../../src/core/economyOps'
const VENDOR_FILE = 'economyOps'

/** 与 /loot/claim、/market/buy 同一档限速 */
const OP_MIN_GAP_MS = 300
const lastOpAt = new Map<number, number>()

/** loot_budgets 件数账:op 名 → 每小时件数/积攒封顶(巡游每日一次,连胜/秘境按真实间隔) */
const OP_BUDGETS: Record<string, { ratePerHour: number; cap: number }> = {
  cave_tour: { ratePerHour: 1 / 24, cap: 1 },
  streak: { ratePerHour: 4, cap: 8 },
  secret_layer: { ratePerHour: 12, cap: 30 }
}

interface EconomyDeductRaw {
  kind?: unknown
  id?: unknown
  grade?: unknown
  uid?: unknown
  idx?: unknown
  qty?: unknown
}

type ResolveOp = (req: unknown, ctx: unknown) => {
  ok: boolean
  reason?: string
  stone?: { m: number; e: number }
  consume?: { key: string; qty: number; permanent?: boolean }
  deduct?: EconomyDeductRaw[]
  gains?: { herb?: number; wudao?: number }
}

/** vendor 回传的扣货清单校验:vendor 打包版本落后时缺字段,逐条放行前先验形状 */
function isDeduct(d: unknown): d is EconomyDeductRaw & { kind: string } {
  return typeof d === 'object' && d !== null && typeof (d as EconomyDeductRaw).kind === 'string'
}

/** 云档里捞出 op 需要的切片(不整档解析也要 major;其余按 op 缺省) */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function slicesOf(data: Record<string, unknown>): Record<string, Record<string, unknown> | undefined> {
  const pick = (id: string): Record<string, unknown> | undefined => {
    const v = data[id]
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : undefined
  }
  return {
    player: pick('player'),
    resources: pick('resources'),
    inventory: pick('inventory'),
    market: pick('market'),
    bounty: pick('bounty'),
    game: pick('game')
  }
}

economyRouter.post('/economy/:op', requireAuth, (req: Request, res: Response) => {
  void (async () => {
    const userId = req.user!.id
    const op = typeof req.params.op === 'string' ? req.params.op : ''
    const now = Date.now()

    const last = lastOpAt.get(userId) ?? 0
    if (now - last < OP_MIN_GAP_MS) {
      res.status(429).json({ error: '操作太快,稍候再试' })
      return
    }
    lastOpAt.set(userId, now)

    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>

    // 复算、记账与落档都在 save 锁内(1.79.11):进项要直接写进云档 resources,
    // 锁外读旧档再锁内写回,会把并发结算(心跳/炼器)刚写的结果顶掉
    await withKeyLock(`save:${userId}`, async () => {
      const row = await get<{ version: number; data: string; updated_at: number; started: number }>(
        'SELECT version, data, updated_at, started FROM saves WHERE user_id = ?',
        [userId]
      )
      if (row === undefined) {
        res.json({ ok: false, reason: '还没有云档' })
        return
      }
      let data: Record<string, unknown>
      try {
        data = JSON.parse(row.data) as Record<string, unknown>
      } catch {
        res.json({ ok: false, reason: '云档不可读' })
        return
      }
      const slices = slicesOf(data)
      const major =
        typeof slices.player?.major === 'number' && Number.isFinite(slices.player.major)
          ? Math.trunc(slices.player.major)
          : 0

      const mod = (await loadClientModule(SOURCE_MODULE, VENDOR_FILE)) as { resolveEconomyOp: ResolveOp }
      // 本窗口已记过的消费/领取:档里的货要到上传才少,校验必须减掉这份量(1.77.1)
      const claimed = await claimedMap(userId)
      const result = mod.resolveEconomyOp(body, {
        now,
        major,
        claimed,
        resources: slices.resources,
        inventory: slices.inventory,
        market: slices.market,
        bounty: slices.bounty
      })

      if (!result.ok || result.stone === undefined) {
        res.json({ ok: false, reason: result.reason ?? '不合法' })
        return
      }

      const budget = OP_BUDGETS[op]
      if (budget !== undefined) {
        const allow = await takeLootBudget(userId, `op:${op}`, 1, now, budget)
        if (allow < 1) {
          res.status(429).json({ error: '今天的次数用完了' })
          return
        }
      }

      // 记账:金额为 0 的进项不落行。消费/领取与进项同锁落下:只记进项不记扣货,
      // 同一批货就能反复卖(1.77.1)。台账留作审计;进项本体自此直接落进云档(见下)
      if (result.consume !== undefined) {
        await recordClaim(userId, result.consume.key, result.consume.qty, result.consume.permanent === true)
      }
      await recordStoneCredit(userId, op, result.stone)

      /*
       * 进项落档(1.79.11):灵石直接加进云档 resources.spiritStone,随整档写回落库。
       * 此前进项只进 stone_ledger,云档从不动 —— 心跳的资源补丁以云档为基线,
       * 本机刚记的进项会被它原样顶掉(与炼器「0 消耗」同一断头链:上传不再携带
       * 资源之后,台账只剩首传一条路可兑现)。写进档后心跳补丁与本地余额同源,不再互顶。
       *
       * 扣货与非灵石进项一并落档(1.79.12):卖出/悬赏交货的「扣货」此前全靠 claims
       * 临时行挡重复,云档行囊从未少掉 —— 已卖的货重登复活,悬赏装备件复活后可反复交
       * 或二次分解;秘境逐层的灵草与通关悟道点只进本地 store,心跳一拍就被顶回。
       */
      const res0 = isPlainObject(data.resources) ? data.resources : null
      const inv0 = isPlainObject(data.inventory) ? data.inventory : null
      const mkt0 = isPlainObject(data.market) ? data.market : null
      const bty0 = isPlainObject(data.bounty) ? data.bounty : null
      let touched = false
      if (res0 !== null && result.stone.m > 0) {
        res0.spiritStone = gnumAdd(res0.spiritStone, result.stone)
        touched = true
      }
      // 非灵石进项(秘境层灵草/悟道):小资源整数直加
      if (res0 !== null && result.gains !== undefined) {
        if (typeof result.gains.herb === 'number' && Number.isFinite(result.gains.herb) && result.gains.herb > 0) {
          res0.herb = Math.max(0, Math.floor(typeof res0.herb === 'number' && Number.isFinite(res0.herb) ? res0.herb : 0)) + Math.floor(result.gains.herb)
          touched = true
        }
        if (typeof result.gains.wudao === 'number' && Number.isFinite(result.gains.wudao) && result.gains.wudao > 0) {
          res0.wudao = Math.max(0, Math.floor(typeof res0.wudao === 'number' && Number.isFinite(res0.wudao) ? res0.wudao : 0)) + Math.floor(result.gains.wudao)
          touched = true
        }
      }
      // 扣货(1.79.12):按 economyOps 回传的清单改云档;形状对不上的整条忽略(宁多挡不少扣)
      for (const d of result.deduct ?? []) {
        if (!isDeduct(d)) continue
        const qty = typeof d.qty === 'number' && Number.isFinite(d.qty) ? Math.floor(d.qty) : 0
        if (d.kind === 'pill' && inv0 !== null && typeof d.id === 'string' && qty > 0) {
          const pills = isPlainObject(inv0.pills) ? (inv0.pills as Record<string, unknown>) : null
          if (pills !== null) {
            const held = typeof pills[d.id] === 'number' && Number.isFinite(pills[d.id]) ? Math.floor(Number(pills[d.id])) : 0
            pills[d.id] = Math.max(0, held - qty)
            touched = true
          }
        } else if (d.kind === 'ore' && res0 !== null && qty > 0) {
          res0.ore = Math.max(0, Math.floor(typeof res0.ore === 'number' && Number.isFinite(res0.ore) ? res0.ore : 0) - qty)
          touched = true
        } else if (d.kind === 'herb' && res0 !== null && typeof d.grade === 'number' && Number.isFinite(d.grade) && qty > 0) {
          const herbs = isPlainObject(res0.herbByGrade) ? (res0.herbByGrade as Record<string, unknown>) : null
          if (herbs !== null) {
            const gkey = String(Math.trunc(d.grade))
            const held = typeof herbs[gkey] === 'number' && Number.isFinite(herbs[gkey]) ? Math.floor(Number(herbs[gkey])) : 0
            herbs[gkey] = Math.max(0, held - qty)
            touched = true
          }
        } else if (d.kind === 'item' && inv0 !== null && typeof d.uid === 'string' && Array.isArray(inv0.items)) {
          const items0 = inv0.items as unknown[]
          const before = items0.length
          inv0.items = items0.filter(
            it => !(typeof it === 'object' && it !== null && (it as Record<string, unknown>).uid === d.uid)
          )
          if ((inv0.items as unknown[]).length !== before) touched = true
        } else if (d.kind === 'consign' && mkt0 !== null && typeof d.idx === 'number' && Array.isArray(mkt0.consign)) {
          const list = mkt0.consign as unknown[]
          if (d.idx >= 0 && d.idx < list.length) {
            list.splice(d.idx, 1)
            touched = true
          }
        } else if (d.kind === 'bounty_mark' && bty0 !== null && typeof d.idx === 'number' && Array.isArray(bty0.orders)) {
          const slot = (bty0.orders as unknown[]).find(
            s => typeof s === 'object' && s !== null && Math.trunc(Number((s as Record<string, unknown>).idx)) === d.idx
          )
          if (typeof slot === 'object' && slot !== null) {
            ;(slot as Record<string, unknown>).claimed = true
            touched = true
          }
        }
      }
      if (touched) {
        try {
          await backupBeforeOverwrite(userId, {
            version: row.version,
            data: JSON.stringify(data),
            updated_at: row.updated_at
          })
        } catch {
          // 留档失败不拦进项
        }
        await upsertByPk('saves', {
          user_id: userId,
          version: row.version,
          data: JSON.stringify(data),
          started: row.started,
          updated_at: row.updated_at
        })
        /*
         * 落档成功后清掉临时消费行(1.79.12):货物已真扣,claims 里 permanent=0 的行
         * 只剩「同拍防重放」意义 —— 落档后的下一拍重放会被云档现值(已扣)拦住。
         * 此前这些行只在首传清理(1.76.0 后存量玩家永远走偏好分支提前 return),
         * 永不清理等于表无限膨胀、卖过的种类被永久占用一份额度。
         */
        try {
          await settleClaims(userId)
        } catch {
          /* 清行失败只多挡一轮,不影响结算 */
        }
        /*
         * 进项台账行也当场清(1.79.13):进项已随档落库、构成下一次裁决的 prev 基线,
         * 台账行再留在 creditStone 窗口里就是双算。此前的清理只在首传分支(save.ts),
         * 1.76.0 后存量玩家永远走偏好推送提前 return —— sumStoneCreditsSince(userId, 0)
         * 变成全历史累计,窗口随历史进项无限膨胀(改包客户端可报到 现值+burst+全历史进项)。
         */
        try {
          await pruneStoneCredits(userId, Date.now())
        } catch {
          /* 清行失败只多放一轮额度,进项本身无损 */
        }
      }
      res.json({ ok: true, recorded: true, stone: result.stone })
    })
  })().catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
})

export { economyRouter }
