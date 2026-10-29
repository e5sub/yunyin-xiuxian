/** 云隐修仙录 · 网游后端入口:REST + WebSocket 同端口 + GM 后台(路径可自定义) */
import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { WebSocketServer } from 'ws'
import { authRouter } from './auth.js'
import { saveRouter } from './routes/save.js'
import { socialRouter, registerPresence } from './routes/social.js'
import { bossRouter } from './routes/boss.js'
import { dungeonRouter } from './routes/dungeon.js'
import { initDb, run } from './db.js'
import { gmPath, gmRouter } from './admin.js'
import { initWsServer, isOnline, notifyUser, registerChatPersist } from './ws.js'
import { getConfigNumber } from './config.js'
import { ensureAdminUser } from './adminBootstrap.js'

const here = dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT ?? 8787)

/** 清理超过留存期的聊天记录(留存天数在 GM 后台「聊天留存天数」可改) */
async function cleanupChat(): Promise<void> {
  const days = Math.max(await getConfigNumber('chat_retention_days', 7), 1)
  const cutoff = Date.now() - days * 86_400_000
  const result = await run('DELETE FROM chat_messages WHERE created_at < ?', [cutoff])
  if (result.affectedRows > 0) console.log(`[chat-cleanup] 已清理 ${result.affectedRows} 条 ${days} 天前的聊天记录`)
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
  // 同域反代部署为主,开发期放行任意来源
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    res.setHeader('Access-Control-Max-Age', '86400')
    if (req.method === 'OPTIONS') {
      res.sendStatus(204)
      return
    }
    next()
  })
  // 存档整包最大 8MB,留余量给 JSON 转义膨胀
  app.use(express.json({ limit: '12mb' }))

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, game: 'yunyin-xiuxian' })
  })
  app.use('/api/auth', authRouter)
  app.use('/api', saveRouter)
  app.use('/api', socialRouter)
  app.use('/api/boss', bossRouter)
  app.use('/api/dungeon', dungeonRouter)

  // GM 后台:路径可自定义;管理 API 在 <path>/api,页面托管同一前缀
  const gm = gmPath()
  app.use(`${gm}/api`, gmRouter)
  const gmIndex = join(here, '..', 'gm', 'index.html')
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
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[server]', err.message)
    res.status(500).json({ error: '服务器异常' })
  })

  const server = createServer(app)
  const wss = new WebSocketServer({ server, path: '/ws' })
  initWsServer(wss)

  registerPresence({ isOnline, notify: (uid, msg) => notifyUser(uid, msg) })

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

  // 聊天留存:启动即清一次,之后每 6 小时清一轮
  void cleanupChat()
  const chatTimer = setInterval(() => {
    void cleanupChat()
  }, 6 * 3_600_000)
  chatTimer.unref()

  server.listen(PORT, () => {
    console.log(`[yunyin-server] listening on :${PORT} (db=${process.env.DB_DRIVER ?? 'sqlite'}, gm=${gm})`)
    console.log('[yunyin-server] 创建管理员: cd server && npm run admin -- 道号 口令;或在 .env 配 GM_USER / GM_PASS')
  })
}

main().catch(e => {
  console.error('[yunyin-server] 启动失败', e)
  process.exit(1)
})
