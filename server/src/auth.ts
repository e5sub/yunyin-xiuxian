/**
 * 注册 / 登录 / 鉴权中间件 / 邮箱验证码 / 找回密码
 * 注册必填用户名(道号) + 邮箱;邮箱验证码预留(game_config.email_code_required=true 强制校验,GM 后台可改)
 */
import bcrypt from 'bcryptjs'
import express, { type NextFunction, type Request, type Response } from 'express'
import jwt from 'jsonwebtoken'
import { get, run } from './db.js'
import { emailEnabled, makeCode, sendCodeMail } from './mail.js'
import { getConfig } from './config.js'
import { jwtSecret } from './secret.js'

const TOKEN_TTL_SEC = 60 * 60 * 24 * 30
const CODE_TTL_MS = 10 * 60 * 1000

export interface AuthUser {
  id: number
  username: string
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser
      isAdmin?: boolean
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
  void (async () => {
    try {
      const payload = jwt.verify(token, jwtSecret())
      if (typeof payload !== 'object' || payload === null || typeof (payload as { uid?: unknown }).uid !== 'number') {
        throw new Error('bad payload')
      }
      const row = await get<{ id: number; username: string; status: string }>(
        'SELECT id, username, status FROM users WHERE id = ?',
        [(payload as { uid: number }).uid]
      )
      if (row === undefined) {
        res.status(401).json({ error: '未登录' })
        return
      }
      if (row.status !== 'active') {
        res.status(403).json({ error: '账号已被封禁' })
        return
      }
      req.user = { id: row.id, username: row.username }
      next()
    } catch {
      res.status(401).json({ error: '登录已过期' })
    }
  })()
}

/** GM 后台鉴权:必须是 role=admin 的活跃账号 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization
  const token = header !== undefined && header.startsWith('Bearer ') ? header.slice(7) : null
  if (token === null) {
    res.status(401).json({ error: '未登录' })
    return
  }
  void (async () => {
    try {
      const payload = jwt.verify(token, jwtSecret())
      const uid = typeof payload === 'object' && payload !== null ? (payload as { uid?: unknown }).uid : undefined
      if (typeof uid !== 'number') throw new Error('bad payload')
      const row = await get<{ id: number; username: string; role: string; status: string }>(
        'SELECT id, username, role, status FROM users WHERE id = ?',
        [uid]
      )
      if (row === undefined || row.role !== 'admin' || row.status !== 'active') {
        res.status(403).json({ error: '无管理权限' })
        return
      }
      req.user = { id: row.id, username: row.username }
      req.isAdmin = true
      next()
    } catch {
      res.status(401).json({ error: '登录已过期' })
    }
  })()
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
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface UserRow {
  id: number
  username: string
  email: string | null
  pass_hash: string
  role: string
  status: string
}

export const authRouter = express.Router()

/** 前端探测:邮箱验证码是否强制(预留开关)、邮箱服务是否启用 */
authRouter.get('/config', (_req, res) => {
  void (async () => {
    res.json({
      emailCodeRequired: (await getConfig('email_code_required')) === 'true',
      emailEnabled: await emailEnabled()
    })
  })().catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
})

/** 发邮箱验证码(purpose: register|reset);SMTP 未启用时响应带 devCode 便于联调 */
authRouter.post('/email-code', (req, res) => {
  void (async () => {
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const purpose = body.purpose === 'reset' ? 'reset' : 'register'
    if (!EMAIL_RE.test(email) || email.length > 190) {
      res.status(400).json({ error: '邮箱格式不对' })
      return
    }
    const user = await get<{ id: number }>('SELECT id FROM users WHERE email_lower = ?', [email])
    if (purpose === 'register' && user !== undefined) {
      res.status(400).json({ error: '该邮箱已注册' })
      return
    }
    if (purpose === 'reset' && user === undefined) {
      // 不暴露邮箱是否存在
      res.json({ ok: true })
      return
    }
    const code = makeCode()
    const now = Date.now()
    await run('INSERT INTO email_codes (email_lower, code, purpose, used, expires_at, created_at) VALUES (?, ?, ?, 0, ?, ?)', [
      email,
      code,
      purpose,
      now + CODE_TTL_MS,
      now
    ])
    const sent = await sendCodeMail(email, code, purpose)
    res.json({ ok: true, ...(sent ? {} : { devCode: code }) })
  })().catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
})

/** 校验验证码;成功则核销 */
async function consumeCode(email: string, code: string, purpose: string): Promise<boolean> {
  const row = await get<{ id: number }>(
    'SELECT id FROM email_codes WHERE email_lower = ? AND purpose = ? AND used = 0 AND code = ? AND expires_at > ? ORDER BY id DESC LIMIT 1',
    [email, purpose, code.trim(), Date.now()]
  )
  if (row === undefined) return false
  await run('UPDATE email_codes SET used = 1 WHERE id = ?', [row.id])
  return true
}

authRouter.post('/register', (req, res) => {
  void (async () => {
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>
    const username = typeof body.username === 'string' ? body.username.trim() : ''
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    const code = typeof body.code === 'string' ? body.code.trim() : ''
    if (!USERNAME_RE.test(username)) {
      res.status(400).json({ error: '道号 2~12 字,限中文/字母/数字/下划线' })
      return
    }
    if (!EMAIL_RE.test(email) || email.length > 190) {
      res.status(400).json({ error: '请填写有效邮箱' })
      return
    }
    if (password.length < 6 || password.length > 64) {
      res.status(400).json({ error: '口令 6~64 字' })
      return
    }
    const lower = username.toLowerCase()
    const nameTaken = await get<{ id: number }>('SELECT id FROM users WHERE username_lower = ?', [lower])
    if (nameTaken !== undefined) {
      res.status(400).json({ error: '道号已被占用' })
      return
    }
    const mailTaken = await get<{ id: number }>('SELECT id FROM users WHERE email_lower = ?', [email])
    if (mailTaken !== undefined) {
      res.status(400).json({ error: '该邮箱已注册' })
      return
    }
    if ((await getConfig('email_code_required')) === 'true') {
      const ok = await consumeCode(email, code, 'register')
      if (!ok) {
        res.status(400).json({ error: '邮箱验证码不对或已过期' })
        return
      }
    }
    const hash = bcrypt.hashSync(password, 10)
    const info = await run(
      'INSERT INTO users (username, username_lower, email, email_lower, pass_hash, role, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [username, lower, email, email, hash, 'player', 'active', Date.now()]
    )
    const user: AuthUser = { id: info.insertId, username }
    res.json({ token: signToken(user), user })
  })().catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
})

authRouter.post('/login', (req, res) => {
  void (async () => {
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>
    const username = typeof body.username === 'string' ? body.username.trim() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    const row = await get<UserRow>('SELECT id, username, email, pass_hash, role, status FROM users WHERE username_lower = ?', [
      username.toLowerCase()
    ])
    if (row === undefined || !bcrypt.compareSync(password, row.pass_hash)) {
      res.status(401).json({ error: '道号或口令不对' })
      return
    }
    if (row.status !== 'active') {
      res.status(403).json({ error: '账号已被封禁' })
      return
    }
    const user: AuthUser = { id: row.id, username: row.username }
    res.json({ token: signToken(user), user })
  })().catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
})

/** 忘记密码:第一步,给邮箱发验证码(不暴露邮箱是否存在) */
authRouter.post('/forgot', (req, res) => {
  void (async () => {
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    if (!EMAIL_RE.test(email) || email.length > 190) {
      res.status(400).json({ error: '邮箱格式不对' })
      return
    }
    const user = await get<{ id: number }>('SELECT id FROM users WHERE email_lower = ?', [email])
    if (user === undefined) {
      res.json({ ok: true })
      return
    }
    const code = makeCode()
    const now = Date.now()
    await run('INSERT INTO email_codes (email_lower, code, purpose, used, expires_at, created_at) VALUES (?, ?, ?, 0, ?, ?)', [
      email,
      code,
      'reset',
      now + CODE_TTL_MS,
      now
    ])
    const sent = await sendCodeMail(email, code, 'reset')
    res.json({ ok: true, ...(sent ? {} : { devCode: code }) })
  })().catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
})

/** 找回密码:第二步,邮箱 + 验证码 + 新口令 */
authRouter.post('/reset', (req, res) => {
  void (async () => {
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const code = typeof body.code === 'string' ? body.code.trim() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    if (!EMAIL_RE.test(email) || email.length > 190) {
      res.status(400).json({ error: '邮箱格式不对' })
      return
    }
    if (password.length < 6 || password.length > 64) {
      res.status(400).json({ error: '口令 6~64 字' })
      return
    }
    const ok = await consumeCode(email, code, 'reset')
    if (!ok) {
      res.status(400).json({ error: '验证码不对或已过期' })
      return
    }
    const hash = bcrypt.hashSync(password, 10)
    const result = await run('UPDATE users SET pass_hash = ? WHERE email_lower = ?', [hash, email])
    if (result.affectedRows === 0) {
      res.status(404).json({ error: '该邮箱未注册' })
      return
    }
    res.json({ ok: true })
  })().catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
})

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user })
})
