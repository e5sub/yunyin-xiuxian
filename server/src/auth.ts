/** 注册 / 登录 / 鉴权中间件 */
import bcrypt from 'bcryptjs'
import express, { type NextFunction, type Request, type Response } from 'express'
import jwt from 'jsonwebtoken'
import { findUserByName, findUserById, insertUser } from './db.js'
import { jwtSecret } from './secret.js'

const TOKEN_TTL_SEC = 60 * 60 * 24 * 30

export interface AuthUser {
  id: number
  username: string
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser
    }
  }
}

export function signToken(user: AuthUser): string {
  return jwt.sign({ uid: user.id }, jwtSecret(), { expiresIn: TOKEN_TTL_SEC })
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization
  const token = header !== undefined && header.startsWith('Bearer ') ? header.slice(7) : null
  if (token === null) {
    res.status(401).json({ error: '未登录' })
    return
  }
  try {
    const payload = jwt.verify(token, jwtSecret())
    if (typeof payload !== 'object' || payload === null || typeof (payload as { uid?: unknown }).uid !== 'number') {
      throw new Error('bad payload')
    }
    const row = findUserById.get((payload as { uid: number }).uid) as { id: number; username: string } | undefined
    if (row === undefined) {
      res.status(401).json({ error: '未登录' })
      return
    }
    req.user = { id: row.id, username: row.username }
    next()
  } catch {
    res.status(401).json({ error: '登录已过期' })
  }
}

/** ws 连接用:从 token 解 uid,无效返回 null */
export function verifyToken(token: string): number | null {
  try {
    const payload = jwt.verify(token, jwtSecret())
    if (typeof payload === 'object' && payload !== null && typeof (payload as { uid?: unknown }).uid === 'number') {
      return (payload as { uid: number }).uid
    }
    return null
  } catch {
    return null
  }
}

const USERNAME_RE = /^[\u4e00-\u9fa5A-Za-z0-9_]{2,12}$/

export const authRouter = express.Router()

authRouter.post('/register', (req, res) => {
  const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>
  const username = typeof body.username === 'string' ? body.username.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  if (!USERNAME_RE.test(username)) {
    res.status(400).json({ error: '道号 2~12 字,限中文/字母/数字/下划线' })
    return
  }
  if (password.length < 6 || password.length > 64) {
    res.status(400).json({ error: '口令 6~64 字' })
    return
  }
  const lower = username.toLowerCase()
  if (findUserByName.get(lower) !== undefined) {
    res.status(400).json({ error: '道号已被占用' })
    return
  }
  const hash = bcrypt.hashSync(password, 10)
  const info = insertUser.run(username, lower, hash, Date.now())
  const user: AuthUser = { id: Number(info.lastInsertRowid), username }
  res.json({ token: signToken(user), user })
})

authRouter.post('/login', (req, res) => {
  const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>
  const username = typeof body.username === 'string' ? body.username.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  const row = findUserByName.get(username.toLowerCase()) as { id: number; username: string; pass_hash: string } | undefined
  if (row === undefined || !bcrypt.compareSync(password, row.pass_hash)) {
    res.status(401).json({ error: '道号或口令不对' })
    return
  }
  const user: AuthUser = { id: row.id, username: row.username }
  res.json({ token: signToken(user), user })
})

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user })
})
