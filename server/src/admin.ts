/**
 * GM 后台:路径可自定义(GM_PATH 环境变量,默认 /gm)
 * 账号管理(列表/搜索/封禁/解封/重置口令/删除) + 角色信息查看 + 游戏关键参数设置 + 全服公告
 * 管理员为 users.role='admin' 的账号;创建见 npm run admin -- <道号> <口令>
 */
import express, { type Request, type Response } from 'express'
import bcrypt from 'bcryptjs'
import { all, get, run } from './db.js'
import { setConfig } from './config.js'
import { requireAdmin } from './auth.js'
import { onlineCount } from './ws.js'

/** 后台挂载路径;必须是一个独立子路径(不允许根路径),非法值回落 /gm */
export function gmPath(): string {
  let raw = (process.env.GM_PATH ?? '/gm').trim()
  if (!raw.startsWith('/')) {
    // 兼容 Windows 环境下被 MSYS 转成盘符路径的情况
    const m = raw.match(/^[A-Za-z]:(\/.*)$/)
    raw = m !== null ? m[1]! : raw === '' ? '/gm' : '/' + raw
  }
  const parts = raw.split('/').filter(p => p !== '' && !/^[A-Za-z]:$/.test(p))
  return parts.length === 0 ? '/gm' : '/' + parts.join('/')
}

export const gmRouter = express.Router()

gmRouter.post('/login', (req: Request, res: Response) => {
  void (async () => {
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>
    const username = typeof body.username === 'string' ? body.username.trim() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    const row = await get<{ id: number; username: string; pass_hash: string; role: string; status: string }>(
      'SELECT id, username, pass_hash, role, status FROM users WHERE username_lower = ?',
      [username.toLowerCase()]
    )
    if (row === undefined || !bcrypt.compareSync(password, row.pass_hash)) {
      res.status(401).json({ error: '道号或口令不对' })
      return
    }
    if (row.role !== 'admin' || row.status !== 'active') {
      res.status(403).json({ error: '无管理权限' })
      return
    }
    // 复用玩家 token 体系,requireAdmin 会校验 role
    const { signToken } = await import('./auth.js')
    res.json({ token: signToken({ id: row.id, username: row.username }) })
  })().catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
})

gmRouter.get('/stats', requireAdmin, (_req: Request, res: Response) => {
  void (async () => {
    const users = await get<{ c: number }>('SELECT COUNT(*) AS c FROM users')
    const saves = await get<{ c: number }>('SELECT COUNT(*) AS c FROM saves')
    const profiles = await get<{ c: number }>('SELECT COUNT(*) AS c FROM profiles')
    const banned = await get<{ c: number }>("SELECT COUNT(*) AS c FROM users WHERE status != 'active'")
    res.json({
      users: users?.c ?? 0,
      saves: saves?.c ?? 0,
      profiles: profiles?.c ?? 0,
      banned: banned?.c ?? 0,
      online: onlineCount()
    })
  })().catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
})

/** 用户列表:search 匹配道号/邮箱;分页 */
gmRouter.get('/users', requireAdmin, (req: Request, res: Response) => {
  void (async () => {
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : ''
    const page = Math.max(Number(req.query.page ?? 1) || 1, 1)
    const pageSize = Math.min(Math.max(Number(req.query.pageSize ?? 20) || 20, 1), 100)
    const like = `%${search.toLowerCase()}%`
    const where = search !== '' ? "WHERE username_lower LIKE ? OR email_lower LIKE ?" : ''
    const params = search !== '' ? [like, like] : []
    const total = await get<{ c: number }>(`SELECT COUNT(*) AS c FROM users ${where}`, params)
    const rows = await all(
      `SELECT u.id, u.username, u.email, u.role, u.status, u.created_at,
              p.name, p.realm_label, p.realm_index, p.power_m, p.power_e, p.updated_at AS profile_at,
              s.updated_at AS save_at
       FROM users u
       LEFT JOIN profiles p ON p.user_id = u.id
       LEFT JOIN saves s ON s.user_id = u.id
       ${where}
       ORDER BY u.id DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize]
    )
    res.json({
      total: total?.c ?? 0,
      page,
      pageSize,
      users: rows.map((r: Record<string, unknown>) => ({
        id: r.id,
        username: r.username,
        email: r.email,
        role: r.role,
        status: r.status,
        createdAt: r.created_at,
        profile:
          r.name !== null && r.name !== undefined
            ? {
                name: r.name,
                realmLabel: r.realm_label,
                realmIndex: r.realm_index,
                powerM: r.power_m,
                powerE: r.power_e,
                updatedAt: r.profile_at
              }
            : null,
        saveAt: r.save_at
      }))
    })
  })().catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
})

/** 单个用户详情:账号 + 档案 + 存档元信息 */
gmRouter.get('/users/:id', requireAdmin, (req: Request, res: Response) => {
  void (async () => {
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: '参数无效' })
      return
    }
    const u = await get<Record<string, unknown>>(
      'SELECT id, username, email, role, status, created_at FROM users WHERE id = ?',
      [id]
    )
    if (u === undefined) {
      res.status(404).json({ error: '查无此用户' })
      return
    }
    const p = await get<Record<string, unknown>>('SELECT * FROM profiles WHERE user_id = ?', [id])
    const s = await get<{ version: number; updated_at: number; LENGTH: number }>(
      "SELECT version, updated_at, LENGTH(data) AS LENGTH FROM saves WHERE user_id = ?",
      [id]
    )
    const friendCount = await get<{ c: number }>(
      "SELECT COUNT(*) AS c FROM friends WHERE (user_id = ? OR friend_id = ?) AND status = 'accepted'",
      [id, id]
    )
    res.json({
      user: u,
      profile: p ?? null,
      save: s === undefined ? null : { version: s.version, updatedAt: s.updated_at, bytes: s.LENGTH },
      friends: friendCount?.c ?? 0
    })
  })().catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
})

gmRouter.post('/users/:id/ban', requireAdmin, (req: Request, res: Response) => {
  void (async () => {
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: '参数无效' })
      return
    }
    if (id === req.user!.id) {
      res.status(400).json({ error: '不能封自己' })
      return
    }
    const result = await run("UPDATE users SET status = 'banned' WHERE id = ? AND role != 'admin'", [id])
    if (result.affectedRows === 0) {
      res.status(400).json({ error: '用户不存在或不可封禁' })
      return
    }
    res.json({ ok: true })
  })().catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
})

gmRouter.post('/users/:id/unban', requireAdmin, (req: Request, res: Response) => {
  void (async () => {
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: '参数无效' })
      return
    }
    await run("UPDATE users SET status = 'active' WHERE id = ?", [id])
    res.json({ ok: true })
  })().catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
})

gmRouter.post('/users/:id/reset-password', requireAdmin, (req: Request, res: Response) => {
  void (async () => {
    const id = Number(req.params.id)
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>
    const password = typeof body.password === 'string' ? body.password : ''
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: '参数无效' })
      return
    }
    if (password.length < 6 || password.length > 64) {
      res.status(400).json({ error: '口令 6~64 字' })
      return
    }
    const result = await run('UPDATE users SET pass_hash = ? WHERE id = ?', [bcrypt.hashSync(password, 10), id])
    if (result.affectedRows === 0) {
      res.status(404).json({ error: '查无此用户' })
      return
    }
    res.json({ ok: true })
  })().catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
})

gmRouter.delete('/users/:id', requireAdmin, (req: Request, res: Response) => {
  void (async () => {
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: '参数无效' })
      return
    }
    if (id === req.user!.id) {
      res.status(400).json({ error: '不能删自己' })
      return
    }
    const row = await get<{ role: string }>('SELECT role FROM users WHERE id = ?', [id])
    if (row === undefined) {
      res.status(404).json({ error: '查无此用户' })
      return
    }
    if (row.role === 'admin') {
      res.status(400).json({ error: '管理员不可删除' })
      return
    }
    // 双方言安全:先删从表再删主表(不依赖外键级联开关)
    await run('DELETE FROM saves WHERE user_id = ?', [id])
    await run('DELETE FROM profiles WHERE user_id = ?', [id])
    await run('DELETE FROM friends WHERE user_id = ? OR friend_id = ?', [id, id])
    await run('DELETE FROM chat_messages WHERE user_id = ?', [id])
    await run('DELETE FROM users WHERE id = ?', [id])
    res.json({ ok: true })
  })().catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
})

/** 游戏关键参数:读全部 */
gmRouter.get('/config', requireAdmin, (_req: Request, res: Response) => {
  void (async () => {
    const { allConfig } = await import('./config.js')
    res.json({ config: await allConfig() })
  })().catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
})

/** 游戏关键参数:写单项 */
gmRouter.put('/config/:key', requireAdmin, (req: Request, res: Response) => {
  void (async () => {
    const key = String(req.params.key)
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>
    const value = typeof body.value === 'string' ? body.value : ''
    const allowed = ['announcement', 'chat_min_interval_ms', 'chat_max_len', 'leaderboard_size', 'chat_history_size']
    if (!allowed.includes(key)) {
      res.status(400).json({ error: '不支持的参数' })
      return
    }
    const nKeys = ['chat_min_interval_ms', 'chat_max_len', 'leaderboard_size', 'chat_history_size']
    if (nKeys.includes(key)) {
      const n = Number(value)
      if (!Number.isInteger(n) || n < 0 || n > 1_000_000) {
        res.status(400).json({ error: '数值参数无效' })
        return
      }
    } else if (value.length > 500) {
      res.status(400).json({ error: '公告最长 500 字' })
      return
    }
    await setConfig(key, value)
    res.json({ ok: true })
  })().catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
})

/** 全服公告:入聊天留档(name=仙官)并广播;公告文本同时写进 game_config.announcement */
gmRouter.post('/broadcast', requireAdmin, (req: Request, res: Response) => {
  void (async () => {
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>
    const content = typeof body.content === 'string' ? body.content.trim().slice(0, 200) : ''
    if (content === '') {
      res.status(400).json({ error: '公告内容不能为空' })
      return
    }
    const now = Date.now()
    await run('INSERT INTO chat_messages (user_id, name, content, created_at) VALUES (?, ?, ?, ?)', [
      req.user!.id,
      '仙官',
      content,
      now
    ])
    await setConfig('announcement', content)
    const { broadcastAll } = await import('./ws.js')
    broadcastAll({ type: 'chat', from: { id: 0, name: '仙官' }, content, at: now, system: true })
    res.json({ ok: true })
  })().catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
})
