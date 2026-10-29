/** 云隐修仙录 · 网游后端入口:REST + WebSocket 同端口 + GM 后台(路径可自定义) */
import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { WebSocketServer } from 'ws'
import { authRouter, KICK_GRACE_MS, registerSessionKick } from './auth.js'
import { saveRouter } from './routes/save.js'
import { socialRouter, registerPresence } from './routes/social.js'
import { bossRouter } from './routes/boss.js'
import { dungeonRouter } from './routes/dungeon.js'
import { initDb, run } from './db.js'
import { gmPath, gmRouter } from './admin.js'
import { initWsServer, isOnline, KICK_WAIT_MS, kickUserSockets, notifyUser, registerChatPersist } from './ws.js'
import { getConfigNumber } from './config.js'
import { ensureAdminUser } from './adminBootstrap.js'

const here = dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT ?? 8787)

/** 清理过期数据:聊天留存期外的记录 + 失效的邮箱验证码 */
async function cleanupExpired(): Promise<void> {
  const days = Math.max(await getConfigNumber('chat_retention_days', 7), 1)
  const now = Date.now()
  const result = await run('DELETE FROM chat_messages WHERE created_at < ?', [now - days * 86_400_000])
  if (result.affectedRows > 0) console.log(`[chat-cleanup] 已清理 ${result.affectedRows} 条 ${days} 天前的聊天记录`)
  await run('DELETE FROM email_codes WHERE expires_at < ?', [now - 86_400_000])
}

async function main(): Promise<void> {
  await initDb()

  // GM 账号可由 env 引导:GM_USER 必填,GM_PASS 给出则同步重置口令(.env 一处控制,重启即生效)
  const gmUser = (process.env.GM_USER ?? '').trim()
  if (gmUser !== '') {
    try {
      console.log('[yunyin-server]', await ensureAdminUser(gmUser, process.env.GM_PASS ?? ''))
    } catch (e) {
      console.error('[yunyin-server] GM_USER 引导失败:', e instanceof Error ? e.message : e)
    }
  }

  const app = express()
  app.disable('x-powered-by')
  // 反代场景取真实客户端 IP(限速按 IP 分桶);默认信任回环(同机 nginx),可用 TRUST_PROXY 覆盖
  app.set('trust proxy', process.env.TRUST_PROXY?.trim() || 'loopback')

  // 跨域白名单:同域与 Capacitor WebView 默认放行,其余来源须在 CORS_ORIGINS(逗号分隔)里显式列出
  const extraOrigins = new Set(
    (process.env.CORS_ORIGINS ?? '')
      .split(',')
      .map(s => s.trim())
      .filter(s => s !== '')
  )
  const embeddedOrigins = new Set(['capacitor://localhost', 'http://localhost', 'https://localhost'])
  // 同域 + Capacitor 壳 + 本机开发端口 + GitHub Pages(线上 Web 站跨域调官方 API)+ CORS_ORIGINS 显式配置
  const originAllowed = (origin: string, req: express.Request): boolean => {
    if (origin === `${req.protocol}://${req.headers.host}`) return true
    if (embeddedOrigins.has(origin) || extraOrigins.has(origin)) return true
    try {
      const u = new URL(origin)
      if (u.protocol === 'https:' && u.hostname.endsWith('.github.io')) return true
      if (u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost')) return true
    } catch {
      return false
    }
    return false
  }
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Referrer-Policy', 'no-referrer')
    // 只有走 HTTPS(反代已终止 TLS)时才发 HSTS,避免把本地 http 调试锁死
    if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000')
    const origin = req.headers.origin
    if (origin !== undefined && originAllowed(origin, req)) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
      res.setHeader('Access-Control-Max-Age', '86400')
    }
    if (req.method === 'OPTIONS') {
      res.sendStatus(204)
      return
    }
    next()
  })

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, game: 'yunyin-xiuxian' })
  })

  // 请求体按路由配额:只有存档需要 12MB(整包 8MB + JSON 转义余量),其余接口收紧以防内存打爆
  const jsonTiny = express.json({ limit: '64kb' })
  const jsonSmall = express.json({ limit: '256kb' })
  const jsonLarge = express.json({ limit: '12mb' })

  app.use('/api/auth', jsonTiny, authRouter)
  app.use('/api/boss', jsonTiny, bossRouter)
  app.use('/api/dungeon', jsonTiny, dungeonRouter)
  app.use('/api/save', jsonLarge)
  app.use('/api', jsonSmall, saveRouter)
  app.use('/api', jsonSmall, socialRouter)

  // GM 后台:路径可自定义;管理 API 在 <path>/api,页面托管同一前缀
  const gm = gmPath()
  app.use(`${gm}/api`, jsonSmall, gmRouter)
  const gmIndex = join(here, '..', 'gm', 'index.html')
  // GM 页是单文件内联样式/脚本,只能放行 inline;仍禁外链脚本、禁被 iframe 嵌套
  const gmCsp =
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; " +
    "script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
  app.use(gm, (_req, res, next) => {
    res.setHeader('Content-Security-Policy', gmCsp)
    next()
  })
  app.use(gm, express.static(join(here, '..', 'gm')))
  if (existsSync(gmIndex)) {
    app.get(gm, (_req, res) => {
      res.type('html').send(readFileSync(gmIndex))
    })
  } else {
    console.warn('[yunyin-server] gm/index.html 缺失,后台页面不可用(API 仍可用)')
  }

  // 可选静态托管(容器部署):STATIC_DIR 指向前端构建产物即开启;本地 dev 不设,纯 API
  const staticDir = process.env.STATIC_DIR ?? ''
  if (staticDir !== '' && existsSync(join(staticDir, 'index.html'))) {
    app.use(express.static(staticDir, { index: 'index.html' }))
    // SPA 兜底:除 /api、/ws、GM 路径外的 GET 一律回 index.html(项目为 hash 路由)
    const gmEscaped = gm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const spaRe = new RegExp(`^(?!${gmEscaped}(?:/|$))(?!/api(?:/|$))(?!/ws(?:/|$)).*`)
    app.get(spaRe, (_req, res) => {
      res.sendFile(join(staticDir, 'index.html'))
    })
    console.log(`[yunyin-server] static site served from ${staticDir}`)
  }

  app.use((_req, res) => {
    res.status(404).json({ error: '接口不存在' })
  })

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error & { status?: number; type?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    // body-parser 的 4xx(entity.too.large / 非法 JSON)按原状态码回,不要一律 500
    const status = typeof err.status === 'number' ? err.status : 500
    if (status === 413) {
      res.status(413).json({ error: '请求体过大' })
      return
    }
    if (status >= 400 && status < 500) {
      res.status(status).json({ error: '请求格式不对' })
      return
    }
    console.error('[server]', err.message)
    res.status(500).json({ error: '服务器异常' })
  })

  const server = createServer(app)
  const wss = new WebSocketServer({ server, path: '/ws' })
  initWsServer(wss)

  registerPresence({ isOnline, notify: (uid, msg) => notifyUser(uid, msg) })

  // 单设备登录:登录时通知旧设备收尾(最后一推存档),等它落库后再签发新会话
  registerSessionKick(uid => kickUserSockets(uid, KICK_WAIT_MS, KICK_GRACE_MS))

  registerChatPersist((uid, name, content, at) => {
    void run('INSERT INTO chat_messages (user_id, name, content, created_at) VALUES (?, ?, ?, ?)', [
      uid,
      name,
      content,
      at
    ]).catch(e => {
      console.error('[chat-persist]', e)
    })
  })

  // 过期数据:启动即清一次,之后每 6 小时清一轮
  void cleanupExpired()
  const cleanupTimer = setInterval(() => {
    void cleanupExpired()
  }, 6 * 3_600_000)
  cleanupTimer.unref()

  server.listen(PORT, () => {
    console.log(`[yunyin-server] listening on :${PORT} (db=${process.env.DB_DRIVER ?? 'sqlite'}, gm=${gm})`)
    console.log('[yunyin-server] 创建管理员: cd server && npm run admin -- 道号 口令;或在 .env 配 GM_USER / GM_PASS')
  })
}

main().catch(e => {
  console.error('[yunyin-server] 启动失败', e)
  process.exit(1)
})
