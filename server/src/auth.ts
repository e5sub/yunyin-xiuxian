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
import { bodyStr, rateLimit } from './rateLimit.js'

const TOKEN_TTL_SEC = 60 * 60 * 24 * 30
const CODE_TTL_MS = 10 * 60 * 1000

/** JWT 只认本服务签发算法,避免算法混淆类攻击 */
const JWT_ALGS = ['HS256'] as const

/**
 * 是否把验证码回给调用方(devCode)。默认关闭:
 * SMTP 未启用/发送失败时验证码只写服务端日志,绝不能回包 —— 否则任何人拿别人邮箱
 * 走「忘记密码」就能拿到可用的重置码,等于账号接管。只在本地联调时显式开。
 */
const DEV_EMAIL_CODE = (process.env.DEV_EMAIL_CODE ?? '').trim() === 'true'

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
      const payload = jwt.verify(token, jwtSecret(), { algorithms: [...JWT_ALGS] })
      if (typeof payload !== 'object' || payload === null || typeof (payload as { uid?: unknown }).uid !== 'number') {
        throw new Error('bad payload')
      }
      const row = await get<{ id: number; username: string; status: string; pass_changed_at: number }>(
        'SELECT id, username, status, pass_changed_at FROM users WHERE id = ?',
        [(payload as { uid: number }).uid]
      )
      if (row === undefined) {
        res.status(401).json({ error: '未登录' })
        return
      }
      // 改密/重置口令后,此前签发的 token 一律作废(留 1 秒余量给同秒签发)
      const iat = typeof (payload as { iat?: unknown }).iat === 'number' ? (payload as { iat: number }).iat : 0
      if (row.pass_changed_at > 0 && iat * 1000 < row.pass_changed_at - 1000) {
        res.status(401).json({ error: '登录已失效,请重新登录' })
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
      const payload = jwt.verify(token, jwtSecret(), { algorithms: [...JWT_ALGS] })
      const uid = typeof payload === 'object' && payload !== null ? (payload as { uid?: unknown }).uid : undefined
      if (typeof uid !== 'number') throw new Error('bad payload')
      const row = await get<{ id: number; username: string; role: string; status: string; pass_changed_at: number }>(
        'SELECT id, username, role, status, pass_changed_at FROM users WHERE id = ?',
        [uid]
      )
      if (row === undefined || row.role !== 'admin' || row.status !== 'active') {
        res.status(403).json({ error: '无管理权限' })
        return
      }
      // 改密后旧 token 同样作废(GM 后台更要紧)
      const iat = typeof (payload as { iat?: unknown }).iat === 'number' ? (payload as { iat: number }).iat : 0
      if (row.pass_changed_at > 0 && iat * 1000 < row.pass_changed_at - 1000) {
        res.status(401).json({ error: '登录已失效,请重新登录' })
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
    const payload = jwt.verify(token, jwtSecret(), { algorithms: [...JWT_ALGS] })
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

// ---- 限速:按 IP 防批量刷,按账号/邮箱防定点爆破 ----
const loginIpLimit = rateLimit({ windowMs: 5 * 60_000, max: 40, message: '登录尝试过多,请稍后再试' })
const loginUserLimit = rateLimit({
  windowMs: 5 * 60_000,
  max: 8,
  key: req => `${req.ip ?? ''}|${bodyStr(req, 'username')}`,
  message: '该账号登录尝试过多,请 5 分钟后再试'
})
const registerLimit = rateLimit({ windowMs: 10 * 60_000, max: 5, message: '注册过于频繁' })
const mailIpLimit = rateLimit({ windowMs: 10 * 60_000, max: 10, message: '请求过于频繁' })
const mailTargetLimit = rateLimit({
  windowMs: 10 * 60_000,
  max: 3,
  key: req => `${req.ip ?? ''}|${bodyStr(req, 'email')}`,
  message: '该邮箱验证码发送过于频繁'
})
const resetIpLimit = rateLimit({ windowMs: 10 * 60_000, max: 10, message: '尝试过多,请稍后再试' })
const resetTargetLimit = rateLimit({
  windowMs: 10 * 60_000,
  max: 5,
  key: req => `${req.ip ?? ''}|${bodyStr(req, 'email')}`,
  message: '该邮箱尝试过多,请稍后再试'
})

/** 账号不存在时也跑一次 bcrypt,抹平时序差异(避免探测道号是否存在) */
const DUMMY_HASH = bcrypt.hashSync('yunyin-dummy-password', 10)

/** 口令校验;hash 缺失也照跑一次 bcrypt,响应时间不泄露账号是否存在 */
export function verifyPassword(hash: string | undefined, password: string): boolean {
  if (hash === undefined) {
    bcrypt.compareSync(password, DUMMY_HASH)
    return false
  }
  return bcrypt.compareSync(password, hash)
}

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
authRouter.post('/email-code', mailIpLimit, mailTargetLimit, (req, res) => {
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
    res.json(sent ? { ok: true } : DEV_EMAIL_CODE ? { ok: true, devCode: code } : { ok: true })
  })().catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
})

/** 校验验证码;成功则核销。同一邮箱+用途 10 分钟内错 5 次即锁死,必须重新获取 */
const CODE_MAX_FAILS = 5
const CODE_FAIL_WINDOW_MS = 10 * 60_000
const codeFailures = new Map<string, number[]>()

async function consumeCode(email: string, code: string, purpose: string): Promise<'ok' | 'bad' | 'locked'> {
  const failKey = `${purpose}|${email}`
  const now = Date.now()
  const fails = (codeFailures.get(failKey) ?? []).filter(t => now - t < CODE_FAIL_WINDOW_MS)
  if (fails.length >= CODE_MAX_FAILS) return 'locked'
  const row = await get<{ id: number }>(
    'SELECT id FROM email_codes WHERE email_lower = ? AND purpose = ? AND used = 0 AND code = ? AND expires_at > ? ORDER BY id DESC LIMIT 1',
    [email, purpose, code.trim(), now]
  )
  if (row === undefined) {
    fails.push(now)
    codeFailures.set(failKey, fails)
    if (fails.length >= CODE_MAX_FAILS) {
      // 锁死时把该邮箱未用验证码一并作废,逼其重新走发送流程(发送侧另有频控)
      await run('UPDATE email_codes SET used = 1 WHERE email_lower = ? AND purpose = ? AND used = 0', [email, purpose])
    }
    return 'bad'
  }
  await run('UPDATE email_codes SET used = 1 WHERE id = ?', [row.id])
  codeFailures.delete(failKey)
  return 'ok'
}

authRouter.post('/register', registerLimit, (req, res) => {
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
      if (ok === 'locked') {
        res.status(429).json({ error: '验证码尝试次数过多,请重新获取' })
        return
      }
      if (ok !== 'ok') {
        res.status(400).json({ error: '邮箱验证码不对或已过期' })
        return
      }
    }
    const hash = bcrypt.hashSync(password, 10)
    const now = Date.now()
    const info = await run(
      'INSERT INTO users (username, username_lower, email, email_lower, pass_hash, role, status, created_at, pass_changed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [username, lower, email, email, hash, 'player', 'active', now, now]
    )
    const user: AuthUser = { id: info.insertId, username }
    res.json({ token: signToken(user), user })
  })().catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
})

authRouter.post('/login', loginIpLimit, loginUserLimit, (req, res) => {
  void (async () => {
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>
    const username = typeof body.username === 'string' ? body.username.trim() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    if (password.length > 200) {
      res.status(401).json({ error: '道号或口令不对' })
      return
    }
    const row = await get<UserRow>('SELECT id, username, email, pass_hash, role, status FROM users WHERE username_lower = ?', [
      username.toLowerCase()
    ])
    if (row === undefined) {
      // 账号不存在也走一次比对:响应时间不泄露道号是否注册
      bcrypt.compareSync(password, DUMMY_HASH)
      res.status(401).json({ error: '道号或口令不对' })
      return
    }
    if (!bcrypt.compareSync(password, row.pass_hash)) {
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
authRouter.post('/forgot', mailIpLimit, mailTargetLimit, (req, res) => {
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
    res.json(sent ? { ok: true } : DEV_EMAIL_CODE ? { ok: true, devCode: code } : { ok: true })
  })().catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
})

/** 找回密码:第二步,邮箱 + 验证码 + 新口令 */
authRouter.post('/reset', resetIpLimit, resetTargetLimit, (req, res) => {
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
    if (ok === 'locked') {
      res.status(429).json({ error: '验证码尝试次数过多,请重新获取' })
      return
    }
    if (ok !== 'ok') {
      res.status(400).json({ error: '验证码不对或已过期' })
      return
    }
    const hash = bcrypt.hashSync(password, 10)
    // 重置口令同时作废已签发的 token(pass_changed_at 参与 requireAuth 校验)
    const result = await run('UPDATE users SET pass_hash = ?, pass_changed_at = ? WHERE email_lower = ?', [
      hash,
      Date.now(),
      email
    ])
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
