/**
 * 坊市成交记账(1.58.1)。
 *
 * 货架内容由服务端按 (major, stockedAt) 确定性再生,预览与购得必是同一物 ——
 * 所以客户端能拿到的「物」本来就不假;假的是**钱**:扣款写在客户端,删掉那几行就白拿。
 *
 * 这里不做成交判定(卖完/过期/行囊满/钱不够仍由客户端判),只做两件事:
 *   1. 按服务端复算的价记一笔账(market_purchases);
 *   2. 存档上传时由数值权威化把这笔钱从「本窗口可增长量」里扣掉(见 core/saveAuthority)。
 * 于是「没付钱」在下一份存档里必然露馅:灵石会对不上。
 */
import express, { type Request, type Response } from 'express'
import { get } from '../db.js'
import { requireAuth } from '../auth.js'
import { quoteMarket } from '../lootGrant.js'
import { recordPurchase } from '../marketLedger.js'

export const marketRouter = express.Router()

/** 与 /loot/claim 同一档限速:买货不比打怪更快 */
const BUY_MIN_GAP_MS = 300
const lastBuyAt = new Map<number, number>()

marketRouter.post('/market/buy', requireAuth, (req: Request, res: Response) => {
  void (async () => {
    const userId = req.user!.id
    const now = Date.now()
    const last = lastBuyAt.get(userId) ?? 0
    if (now - last < BUY_MIN_GAP_MS) {
      res.status(429).json({ error: '操作太快,稍候再试' })
      return
    }
    lastBuyAt.set(userId, now)

    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>
    const stockedAt = typeof body.stockedAt === 'number' && Number.isFinite(body.stockedAt) ? Math.trunc(body.stockedAt) : 0
    const idx = typeof body.idx === 'number' && Number.isFinite(body.idx) ? Math.trunc(body.idx) : -1
    if (stockedAt <= 0 || idx < 0) {
      res.status(400).json({ error: '参数不完整' })
      return
    }

    // 定价按云档的境界复算:客户端自报的 major 不作数(抬境界顺带抬价不是玩家该得的)
    const row = await get<{ data: string }>('SELECT data FROM saves WHERE user_id = ?', [userId])
    if (row === undefined) {
      // 还没上传过存档(新号):没有可比对的境界,不记账也不拦卖
      res.json({ ok: true, recorded: false })
      return
    }
    let major = 0
    try {
      const data = JSON.parse(row.data) as Record<string, unknown>
      const player = typeof data.player === 'object' && data.player !== null ? (data.player as Record<string, unknown>) : {}
      major = typeof player.major === 'number' && Number.isFinite(player.major) ? Math.trunc(player.major) : 0
    } catch {
      res.json({ ok: true, recorded: false })
      return
    }

    const price = await quoteMarket(major, stockedAt, idx)
    if (price === null) {
      // 这一格在服务端的货架上不是货(过期/换架/格号不对):不记账,客户端按「过期」处理
      res.json({ ok: false, recorded: false })
      return
    }
    await recordPurchase(userId, { m: price.m, e: price.e })
    res.json({ ok: true, recorded: true })
  })().catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
})
