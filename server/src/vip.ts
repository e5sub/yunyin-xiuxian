/**
 * VIP 激活码:GM 批量生成(月卡/半年卡/年卡/永久卡),玩家自助兑换。
 * 永久卡以远期时间戳(2100-01-01)落库,与现有 vip_until 判定逻辑天然兼容。
 */
import { randomBytes } from 'node:crypto'
import express, { type Request, type Response } from 'express'
import { get, run } from './db.js'
import { requireAuth } from './auth.js'
import { rateLimit } from './rateLimit.js'

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

/* ---------------- 玩家兑换 ---------------- */

export const vipRouter = express.Router()

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
