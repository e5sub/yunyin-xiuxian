/**
 * 进程内滑动窗口限速:单实例部署够用,多实例横向扩容需换 Redis/网关层限流。
 * 只依赖 req.ip 与请求体,不落库;过期桶按分钟懒清扫,内存不会无限增长。
 */
import type { NextFunction, Request, Response } from 'express'

interface Options {
  windowMs: number
  max: number
  /** 取限速键;返回空串表示本次不计数 */
  key?: (req: Request) => string
  message?: string
}

export function rateLimit(opts: Options): (req: Request, res: Response, next: NextFunction) => void {
  const buckets = new Map<string, number[]>()
  let lastSweep = Date.now()

  return (req, res, next) => {
    const key = opts.key === undefined ? (req.ip ?? 'unknown') : opts.key(req)
    if (key === '') {
      next()
      return
    }
    const now = Date.now()
    if (now - lastSweep > 60_000) {
      lastSweep = now
      for (const [k, hits] of buckets) {
        const newest = hits[hits.length - 1]
        if (newest === undefined || now - newest > opts.windowMs) buckets.delete(k)
      }
    }
    const hits = (buckets.get(key) ?? []).filter(t => now - t < opts.windowMs)
    if (hits.length >= opts.max) {
      const oldest = hits[0] ?? now
      res.setHeader('Retry-After', String(Math.max(Math.ceil((opts.windowMs - (now - oldest)) / 1000), 1)))
      res.status(429).json({ error: opts.message ?? '操作太频繁,请稍后再试' })
      return
    }
    hits.push(now)
    buckets.set(key, hits)
    next()
  }
}

/** 从请求体取字符串字段(限速键常用) */
export function bodyStr(req: Request, field: string): string {
  const body = req.body
  if (typeof body !== 'object' || body === null) return ''
  const v = (body as Record<string, unknown>)[field]
  return typeof v === 'string' ? v.trim().toLowerCase() : ''
}
