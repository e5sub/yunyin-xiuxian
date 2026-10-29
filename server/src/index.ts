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

const here = dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT ?? 8787)

async function main(): Promise<void> {
  await initDb()

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

  server.listen(PORT, () => {
    console.log(`[yunyin-server] listening on :${PORT} (db=${process.env.DB_DRIVER ?? 'sqlite'}, gm=${gm})`)
    console.log('[yunyin-server] 创建管理员: cd server && npm run admin -- 道号 口令')
  })
}

main().catch(e => {
  console.error('[yunyin-server] 启动失败', e)
  process.exit(1)
})
