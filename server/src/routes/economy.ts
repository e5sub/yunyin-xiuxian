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
import { get } from '../db.js'
import { requireAuth } from '../auth.js'
import { loadClientModule } from '../clientVendor.js'
import { withKeyLock } from '../mutex.js'
import { recordStoneCredit } from '../stoneLedger.js'
import { claimedMap, recordClaim } from '../economyLedger.js'
import { takeLootBudget } from '../lootLedger.js'

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

type ResolveOp = (req: unknown, ctx: unknown) => {
  ok: boolean
  reason?: string
  stone?: { m: number; e: number }
  consume?: { key: string; qty: number; permanent?: boolean }
}

/** 云档里捞出 op 需要的切片(不整档解析也要 major;其余按 op 缺省) */
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

    // 件数账放在复算**通过之后**再取:被拒的单不吞配额,合法重试不被误伤
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>
    const row = await get<{ data: string }>('SELECT data FROM saves WHERE user_id = ?', [userId])
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
      typeof slices.player?.major === 'number' && Number.isFinite(slices.player.major) ? Math.trunc(slices.player.major) : 0

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

    // 复算通过:记账(锁内,防与上传裁决交错)。金额为 0 的进项不落行。
    // 消费/领取与进项同锁落下:只记进项不记扣货,同一批货就能反复卖(1.77.1)
    await withKeyLock(`save:${userId}`, async () => {
      if (result.consume !== undefined) {
        await recordClaim(userId, result.consume.key, result.consume.qty, result.consume.permanent === true)
      }
      await recordStoneCredit(userId, op, result.stone!)
    })
    res.json({ ok: true, recorded: true, stone: result.stone })
  })().catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
})

export { economyRouter }
