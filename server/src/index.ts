/** 云隐修仙录 · 网游后端入口:REST + WebSocket 同端口 */
import { createServer } from 'node:http'
import express from 'express'
import { WebSocketServer } from 'ws'
import { authRouter } from './auth.js'
import { saveRouter } from './routes/save.js'
import { socialRouter, registerPresence } from './routes/social.js'
import { db } from './db.js'
import { initWsServer, isOnline, notifyUser, registerChatPersist } from './ws.js'

const PORT = Number(process.env.PORT ?? 8787)

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

const insertChat = db.prepare('INSERT INTO chat_messages (user_id, name, content, created_at) VALUES (?, ?, ?, ?)')
registerChatPersist((uid, name, content, at) => {
  try {
    insertChat.run(uid, name, content, at)
  } catch (e) {
    console.error('[chat-persist]', e)
  }
})

server.listen(PORT, () => {
  console.log(`[yunyin-server] listening on :${PORT}`)
})
