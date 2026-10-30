/**
 * VIP 激活码:GM 批量生成(月卡/半年卡/年卡/永久卡),玩家自助兑换。
 * 永久卡以远期时间戳(2100-01-01)落库,与现有 vip_until 判定逻辑天然兼容。
 */
import { randomBytes } from 'node:crypto'
import express, { type Request, type Response } from 'express'
import QRCode from 'qrcode'
import { get, run } from './db.js'
import { requireAuth } from './auth.js'
import { rateLimit } from './rateLimit.js'
import { allConfig } from './config.js'
import { alipayConfig, tradePrecreate, tradeQuery } from './alipay.js'

/** 永久 VIP 的落库到期时间:2100-01-01 00:00:00 UTC(远大于任何常规时长) */
export const PERMANENT_TS = 4102444800000

export type CodeType = 'month' | 'half' | 'year' | 'forever'

/** 激活码类型 → 天数(0 = 永久) */
export const CODE_TYPE_DAYS: Record<CodeType, number> = {
  month: 30,
  half: 183,
  year: 365,
  forever: 0
}

export function isCodeType(v: unknown): v is CodeType {
  return v === 'month' || v === 'half' || v === 'year' || v === 'forever'
}

/** 激活码格式:VIP-XXXX-XXXX-XXXX,去掉易混淆字符(0/O/1/I/L) */
const CODE_RE = /^VIP-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/
const CHARSET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'

export function generateCode(): string {
  const buf = randomBytes(12)
  let s = 'VIP-'
  for (let i = 0; i < 12; i++) {
    s += CHARSET[buf[i]! % CHARSET.length]
    if (i === 3 || i === 7) s += '-'
  }
  return s
}

/** 发放/续期 VIP:days>0 从 max(现在,现有到期) 起叠加;days=0 = 永久。返回新到期时间戳 */
export async function grantVipDays(userId: number, days: number): Promise<number> {
  const row = await get<{ vip_until: number }>('SELECT vip_until FROM users WHERE id = ?', [userId])
  if (row === undefined) throw new Error('查无此用户')
  let vipUntil: number
  if (days <= 0) {
    vipUntil = PERMANENT_TS
  } else {
    // 已是永久(到期 ≥ 永久阈值)则续期不动它;否则在剩余时长上叠加,并夹到永久阈值以内
    if ((row.vip_until ?? 0) >= PERMANENT_TS) return PERMANENT_TS
    const base = Math.max(Date.now(), row.vip_until ?? 0)
    vipUntil = Math.min(base + days * 86400000, PERMANENT_TS)
  }
  await run('UPDATE users SET vip_until = ? WHERE id = ?', [vipUntil, userId])
  return vipUntil
}

/* ---------------- 路由:当面付自助开通 + 激活码兑换 ---------------- */

export const vipRouter = express.Router()

/* ---------------- 当面付自助开通:定价 / 下单 / 查单 ---------------- */

export type PriceType = 'month' | 'half' | 'year' | 'forever'

const PRICE_KEYS: Record<PriceType, string> = {
  month: 'vip_price_month',
  half: 'vip_price_half',
  year: 'vip_price_year',
  forever: 'vip_price_forever'
}

/** 各档定价(元);<= 0 视为该档未开放 */
async function vipPrices(): Promise<Record<PriceType, number>> {
  const cfg = await allConfig()
  const read = (k: string): number => {
    const n = Number(cfg[k])
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0
  }
  return {
    month: read(PRICE_KEYS.month),
    half: read(PRICE_KEYS.half),
    year: read(PRICE_KEYS.year),
    forever: read(PRICE_KEYS.forever)
  }
}

function isPriceType(v: unknown): v is PriceType {
  return v === 'month' || v === 'half' || v === 'year' || v === 'forever'
}

/** 定价与开关(未登录可读,登录页不展示;设置页自行判断登录态) */
vipRouter.get('/pricing', (_req: Request, res: Response) => {
  void (async () => {
    const cfg = await alipayConfig()
    res.json({ enabled: cfg !== null, prices: await vipPrices() })
  })().catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
})

// 下单限速:按 IP+账号,10 分钟 20 次
const orderLimit = rateLimit({
  windowMs: 10 * 60_000,
  max: 20,
  key: (req: Request) => `${req.ip ?? ''}|${req.user?.id ?? 0}`,
  message: '下单过于频繁,请稍后再试'
})

const SUBJECT_TEXT: Record<PriceType, string> = {
  month: 'VIP 月卡',
  half: 'VIP 半年卡',
  year: 'VIP 年卡',
  forever: 'VIP 永久卡'
}

/** 订单有效期:与 precreate 的 timeout_express 一致,过后前端停止轮询 */
const ORDER_TTL_MS = 15 * 60_000

vipRouter.post('/order', requireAuth, orderLimit, (req: Request, res: Response) => {
  void (async () => {
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>
    if (!isPriceType(body.type)) {
      res.status(400).json({ error: '档位无效' })
      return
    }
    const cfg = await alipayConfig()
    if (cfg === null) {
      res.status(400).json({ error: '支付宝支付未开启' })
      return
    }
    const prices = await vipPrices()
    const amount = prices[body.type]
    if (amount <= 0) {
      res.status(400).json({ error: '该档位未开放' })
      return
    }
    const outTradeNo = `VIP${req.user!.id}${Date.now()}${randomBytes(2).toString('hex').toUpperCase()}`.slice(0, 64)
    const amountText = amount.toFixed(2)
    const pre = await tradePrecreate(cfg, outTradeNo, amountText, `云隐修仙录 ${SUBJECT_TEXT[body.type]}`)
    if (!pre.ok || pre.qrCode === undefined) {
      res.status(502).json({ error: pre.error ?? '下单失败' })
      return
    }
    const now = Date.now()
    await run('INSERT INTO vip_orders (out_trade_no, user_id, type, days, amount, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      outTradeNo,
      req.user!.id,
      body.type,
      CODE_TYPE_DAYS[body.type],
      amountText,
      'pending',
      now
    ])
    const qrDataUrl = await QRCode.toDataURL(pre.qrCode, { width: 256, margin: 1 })
    res.json({ outTradeNo, qrDataUrl, amountYuan: amount, days: CODE_TYPE_DAYS[body.type], expireAt: now + ORDER_TTL_MS })
  })().catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
})

vipRouter.get('/order/:no/status', requireAuth, (req: Request, res: Response) => {
  void (async () => {
    const no = String(req.params.no).trim()
    if (!/^VIP[0-9A-Z]+$/.test(no)) {
      res.status(400).json({ error: '订单号无效' })
      return
    }
    const order = await get<{ user_id: number; status: string; days: number; amount: string; created_at: number }>(
      'SELECT user_id, status, days, amount, created_at FROM vip_orders WHERE out_trade_no = ?',
      [no]
    )
    if (order === undefined || order.user_id !== req.user!.id) {
      res.status(404).json({ error: '订单不存在' })
      return
    }
    if (order.status !== 'pending') {
      res.json({ status: order.status, vipUntil: order.status === 'paid' ? (await currentVipUntil(req.user!.id)) : undefined })
      return
    }
    // 15 分钟超时且支付宝侧也已关单:落 closed;支付宝侧若实际已支付仍会照常发放
    const cfg = await alipayConfig()
    if (cfg === null) {
      res.json({ status: 'pending' })
      return
    }
    const q = await tradeQuery(cfg, no)
    if (q.status === 'paid') {
      // 金额对账:支付金额必须与订单一致才发放
      if (q.amount !== undefined && Math.abs(Number(q.amount) - Number(order.amount)) > 0.001) {
        res.json({ status: 'pending', note: '金额不符,待人工核验' })
        return
      }
      await run("UPDATE vip_orders SET status = 'paid', paid_at = ? WHERE out_trade_no = ? AND status = 'pending'", [Date.now(), no])
      const vipUntil = await grantVipDays(req.user!.id, order.days)
      res.json({ status: 'paid', vipUntil })
      return
    }
    if (q.status === 'closed' || (q.status === 'waiting' && Date.now() - order.created_at > ORDER_TTL_MS + 60_000)) {
      await run("UPDATE vip_orders SET status = 'closed' WHERE out_trade_no = ? AND status = 'pending'", [no])
      res.json({ status: 'closed' })
      return
    }
    res.json({ status: 'pending' })
  })().catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
})

async function currentVipUntil(userId: number): Promise<number> {
  const row = await get<{ vip_until: number }>('SELECT vip_until FROM users WHERE id = ?', [userId])
  return row?.vip_until ?? 0
}

/* ---------------- 玩家兑换 ---------------- */

// 兑换限速:按 IP+账号,10 分钟 10 次,防撞码
const redeemLimit = rateLimit({
  windowMs: 10 * 60_000,
  max: 10,
  key: (req: Request) => `${req.ip ?? ''}|${req.user?.id ?? 0}`,
  message: '尝试过于频繁,请 10 分钟后再试'
})

vipRouter.post('/redeem', requireAuth, redeemLimit, (req: Request, res: Response) => {
  void (async () => {
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>
    const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : ''
    if (!CODE_RE.test(code)) {
      res.status(400).json({ error: '激活码格式不对(应为 VIP-XXXX-XXXX-XXXX)' })
      return
    }
    const row = await get<{ days: number; used_by: number }>('SELECT days, used_by FROM vip_codes WHERE code = ?', [code])
    if (row === undefined) {
      res.status(404).json({ error: '激活码不存在' })
      return
    }
    if (row.used_by !== 0) {
      res.status(400).json({ error: '激活码已被使用' })
      return
    }
    // 原子占用:并发兑换同一码只有一个能成
    const claim = await run('UPDATE vip_codes SET used_by = ?, used_at = ? WHERE code = ? AND used_by = 0', [
      req.user!.id,
      Date.now(),
      code
    ])
    if (claim.affectedRows === 0) {
      res.status(400).json({ error: '激活码已被使用' })
      return
    }
    const vipUntil = await grantVipDays(req.user!.id, row.days)
    res.json({ ok: true, days: row.days, vipUntil })
  })().catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
})
