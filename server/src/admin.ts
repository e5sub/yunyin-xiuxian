/**
 * GM 后台:路径可自定义(GM_PATH 环境变量,默认 /gm)
 * 账号管理(列表/搜索/封禁/解封/重置口令/删除) + 角色信息查看 + 游戏关键参数设置 + 全服公告
 * 管理员为 users.role='admin' 的账号;创建见 npm run admin -- <道号> <口令>
 */
import express, { type Request, type Response } from 'express'
import bcrypt from 'bcryptjs'
import { all, get, run, upsertByPk } from './db.js'
import { setConfig } from './config.js'
import { requireAdmin, verifyPassword } from './auth.js'
import { onlineCount } from './ws.js'
import { bodyStr, rateLimit } from './rateLimit.js'
import { CODE_TYPE_DAYS, generateCode, grantVipDays, isCodeType } from './vip.js'

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

// GM 登录限速:后台只有少数账号,严格按 IP + 账号双限,防口令爆破
const gmLoginIpLimit = rateLimit({ windowMs: 5 * 60_000, max: 20, message: '请求过多,请稍后再试' })
const gmLoginUserLimit = rateLimit({
  windowMs: 5 * 60_000,
  max: 5,
  key: req => `${req.ip ?? ''}|${bodyStr(req, 'username')}`,
  message: '登录尝试过多,请 5 分钟后再试'
})

gmRouter.post('/login', gmLoginIpLimit, gmLoginUserLimit, (req: Request, res: Response) => {
  void (async () => {
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>
    const username = typeof body.username === 'string' ? body.username.trim() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    const row = await get<{ id: number; username: string; pass_hash: string; role: string; status: string }>(
      'SELECT id, username, pass_hash, role, status FROM users WHERE username_lower = ?',
      [username.toLowerCase()]
    )
    if (row === undefined || !verifyPassword(row.pass_hash, password)) {
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
    // 页码夹到有效范围:超出总页数退回最后一页(空条件时至少第 1 页),防止翻出空页
    const maxPage = Math.max(Math.ceil((total?.c ?? 0) / pageSize), 1)
    const effPage = Math.min(page, maxPage)
    const rows = await all(
      `SELECT u.id, u.username, u.email, u.role, u.status, u.created_at, u.vip_until,
              p.name, p.realm_label, p.realm_index, p.power_m, p.power_e,
              p.hp_m, p.hp_e, p.atk_m, p.atk_e, p.def_m, p.def_e, p.updated_at AS profile_at,
              s.updated_at AS save_at
       FROM users u
       LEFT JOIN profiles p ON p.user_id = u.id
       LEFT JOIN saves s ON s.user_id = u.id
       ${where}
       ORDER BY u.id DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, (effPage - 1) * pageSize]
    )
    res.json({
      total: total?.c ?? 0,
      page: effPage,
      pageSize,
      users: rows.map((r: Record<string, unknown>) => ({
        id: r.id,
        username: r.username,
        email: r.email,
        role: r.role,
        status: r.status,
        createdAt: r.created_at,
        vipUntil: r.vip_until ?? 0,
        profile:
          r.name !== null && r.name !== undefined
            ? {
                name: r.name,
                realmLabel: r.realm_label,
                realmIndex: r.realm_index,
                powerM: r.power_m,
                powerE: r.power_e,
                hpM: r.hp_m,
                hpE: r.hp_e,
                atkM: r.atk_m,
                atkE: r.atk_e,
                defM: r.def_m,
                defE: r.def_e,
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
      'SELECT id, username, email, role, status, created_at, vip_until FROM users WHERE id = ?',
      [id]
    )
    if (u === undefined) {
      res.status(404).json({ error: '查无此用户' })
      return
    }
    const p = await get<Record<string, unknown>>('SELECT * FROM profiles WHERE user_id = ?', [id])
    const s = await get<{ version: number; started: number; updated_at: number; LENGTH: number }>(
      "SELECT version, started, updated_at, LENGTH(data) AS LENGTH FROM saves WHERE user_id = ?",
      [id]
    )
    const friendCount = await get<{ c: number }>(
      "SELECT COUNT(*) AS c FROM friends WHERE (user_id = ? OR friend_id = ?) AND status = 'accepted'",
      [id, id]
    )
    res.json({
      user: u,
      profile: p ?? null,
      save: s === undefined ? null : { version: s.version, started: s.started === 1, updatedAt: s.updated_at, bytes: s.LENGTH },
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

gmRouter.post('/users/:id/vip', requireAdmin, (req: Request, res: Response) => {
  void (async () => {
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: '参数无效' })
      return
    }
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>
    const days = Math.floor(Number(body.days))
    // days>0 发放/续期(从「当前剩余或现在」的较晚者起算,叠加不浪费);days=0 清零
    if (!Number.isFinite(days) || days < 0 || days > 3650) {
      res.status(400).json({ error: '天数须在 0~3650 之间(0 为取消 VIP)' })
      return
    }
    const row = await get<{ vip_until: number }>('SELECT vip_until FROM users WHERE id = ?', [id])
    if (row === undefined) {
      res.status(404).json({ error: '查无此用户' })
      return
    }
    // days=0 清零;days>0 走统一发放逻辑(永久态不叠加)
    const vipUntil = days > 0 ? await grantVipDays(id, days) : 0
    if (days === 0) await run('UPDATE users SET vip_until = 0 WHERE id = ?', [id])
    res.json({ ok: true, vipUntil })
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
    const result = await run('UPDATE users SET pass_hash = ?, pass_changed_at = ? WHERE id = ?', [
      bcrypt.hashSync(password, 10),
      Date.now(),
      id
    ])
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
    const allowed = [
      'announcement',
      'chat_min_interval_ms',
      'chat_max_len',
      'leaderboard_size',
      'chat_history_size',
      'chat_retention_days',
      'save_push_interval_sec',
      'save_history_keep',
      'turnstile_site_key',
      'turnstile_secret_key',
      'boss_daily_attempts',
      'boss_hp_atk_mult',
      'boss_strike_rounds',
      'boss_respawn_sec',
      'boss_reward_stone',
      'boss_reward_herb',
      'boss_growth_per_kill',
      'boss_growth_reset_days',
      'boss_autoops_smart',
      'boss_kill_equip_drop',
      // 副本(心魔镜像/秘境共探/洞天守卫/共修大阵)
      'demon_daily_attempts',
      'demon_hp_base',
      'demon_atk_mult',
      'demon_reward_stone',
      'demon_reward_herb',
      'explore_daily_attempts',
      'explore_nodes',
      'explore_reward_stone',
      'explore_reward_herb',
      'guard_daily_attempts',
      'guard_max_waves',
      'guard_reward_stone',
      'guard_reward_herb',
      'array_daily_attempts',
      'array_reward_stone',
      'array_reward_herb',
      'dungeon_realm_power_pct',
      'dungeon_realm_reward_pct',
      'dungeon_equip_drop_peril',
      'dungeon_equip_drop_abyss',
      'dungeon_growth_power_pct',
      'dungeon_growth_reset_days',
      // 邮件 / SMTP
      'email_enabled',
      'email_code_required',
      'smtp_host',
      'smtp_port',
      'smtp_user',
      'smtp_pass',
      'smtp_from',
      // 支付宝当面付 + VIP 定价(元)
      'alipay_enabled',
      'alipay_app_id',
      'alipay_merchant_private_key',
      'alipay_alipay_public_key',
      'vip_price_month',
      'vip_price_half',
      'vip_price_year',
      'vip_price_forever'
    ]
    if (!allowed.includes(key)) {
      res.status(400).json({ error: '不支持的参数' })
      return
    }
    const nKeys = [
      'chat_min_interval_ms',
      'chat_max_len',
      'leaderboard_size',
      'chat_history_size',
      'chat_retention_days',
      'save_push_interval_sec',
      'save_history_keep',
      'turnstile_site_key',
      'turnstile_secret_key',
      'boss_daily_attempts',
      'boss_hp_atk_mult',
      'boss_strike_rounds',
      'boss_respawn_sec',
      'boss_reward_stone',
      'boss_reward_herb',
      'boss_growth_per_kill',
      'boss_growth_reset_days',
      'boss_kill_equip_drop',
      'demon_daily_attempts',
      'demon_hp_base',
      'demon_atk_mult',
      'demon_reward_stone',
      'demon_reward_herb',
      'explore_daily_attempts',
      'explore_nodes',
      'explore_reward_stone',
      'explore_reward_herb',
      'guard_daily_attempts',
      'guard_max_waves',
      'guard_reward_stone',
      'guard_reward_herb',
      'array_daily_attempts',
      'array_reward_stone',
      'array_reward_herb',
      'dungeon_realm_power_pct',
      'dungeon_realm_reward_pct',
      'dungeon_equip_drop_peril',
      'dungeon_equip_drop_abyss',
      'dungeon_growth_power_pct',
      'dungeon_growth_reset_days',
      'smtp_port'
    ]
    const boolKeys = ['email_enabled', 'email_code_required', 'alipay_enabled', 'boss_autoops_smart', 'turnstile_enabled']
    // VIP 定价:元,最多两位小数(0 = 该档不开放)
    const priceKeys = ['vip_price_month', 'vip_price_half', 'vip_price_year', 'vip_price_forever']
    // 支付宝密钥:PKCS8 base64 较长
    const longTextKeys = ['alipay_merchant_private_key', 'alipay_alipay_public_key']
    if (nKeys.includes(key)) {
      const n = Number(value)
      if (!Number.isInteger(n) || n < 0 || n > 1_000_000) {
        res.status(400).json({ error: '数值参数无效' })
        return
      }
    } else if (priceKeys.includes(key)) {
      const n = Number(value)
      if (!Number.isFinite(n) || n < 0 || n > 100_000) {
        res.status(400).json({ error: '价格须在 0~100000 之间(0 = 该档不开放)' })
        return
      }
    } else if (boolKeys.includes(key)) {
      if (value !== 'true' && value !== 'false') {
        res.status(400).json({ error: '只接受 true / false' })
        return
      }
    } else if (longTextKeys.includes(key)) {
      if (value.length > 4000) {
        res.status(400).json({ error: '密钥过长' })
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

/** 发测试邮件:验证 SMTP 设置;默认发给当前管理员注册邮箱,也可指定收件人 */
gmRouter.post('/email-test', requireAdmin, (req: Request, res: Response) => {
  void (async () => {
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>
    let to = typeof body.email === 'string' ? body.email.trim() : ''
    if (to === '') {
      const row = await get<{ email: string | null }>('SELECT email FROM users WHERE id = ?', [req.user!.id])
      to = row?.email ?? ''
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      res.status(400).json({ error: '没有可用的收件邮箱(管理员账号未填邮箱)' })
      return
    }
    const { sendTestMail } = await import('./mail.js')
    const err = await sendTestMail(to)
    if (err !== null) {
      res.status(400).json({ error: err })
      return
    }
    res.json({ ok: true, to })
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

/* ---------------- 云存档管理:查档 / 历史 / 回滚 ---------------- */

/** 存档列表:按更新时间倒序;q 命中道号或角色名 */
gmRouter.get('/saves', requireAdmin, (req: Request, res: Response) => {
  void (async () => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : ''
    const limit = Math.min(Math.max(Number(req.query.limit ?? 50) || 50, 1), 200)
    const where = q === '' ? '' : 'WHERE u.username_lower LIKE ? OR LOWER(p.name) LIKE ?'
    const params: unknown[] = q === '' ? [] : [`%${q}%`, `%${q}%`]
    params.push(limit)
    const rows = await all<Record<string, unknown>>(
      `SELECT s.user_id, u.username, p.name, p.realm_label, p.realm_index, p.power_e, p.power_m,
              s.version, s.started, s.updated_at, LENGTH(s.data) AS bytes
       FROM saves s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN profiles p ON p.user_id = s.user_id
       ${where}
       ORDER BY s.updated_at DESC
       LIMIT ?`,
      params
    )
    res.json({
      saves: rows.map(r => ({
        userId: r.user_id,
        username: r.username,
        name: r.name ?? '',
        realmLabel: r.realm_label ?? '',
        realmIndex: r.realm_index ?? 0,
        powerE: r.power_e ?? 0,
        powerM: r.power_m ?? 0,
        version: r.version,
        started: Number(r.started) === 1,
        updatedAt: r.updated_at,
        bytes: r.bytes ?? 0
      }))
    })
  })().catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
})

/** 某人的存档历史(只列元信息,不传档体) */
gmRouter.get('/saves/:userId/history', requireAdmin, (req: Request, res: Response) => {
  void (async () => {
    const userId = Number(req.params.userId)
    if (!Number.isInteger(userId) || userId <= 0) {
      res.status(400).json({ error: '参数无效' })
      return
    }
    const rows = await all<Record<string, unknown>>(
      'SELECT id, version, realm_index, size, updated_at, created_at FROM save_history WHERE user_id = ? ORDER BY id DESC LIMIT 100',
      [userId]
    )
    res.json({ history: rows })
  })().catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
})

/** 回滚某人的存档到指定历史版本(当前档先入历史,可再回滚回来) */
gmRouter.post('/saves/:userId/restore', requireAdmin, (req: Request, res: Response) => {
  void (async () => {
    const userId = Number(req.params.userId)
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>
    const historyId = typeof body.historyId === 'number' && Number.isFinite(body.historyId) ? Math.trunc(body.historyId) : 0
    if (!Number.isInteger(userId) || userId <= 0 || historyId <= 0) {
      res.status(400).json({ error: '参数无效' })
      return
    }
    const row = await get<{ version: number; data: string; updated_at: number }>(
      'SELECT version, data, updated_at FROM save_history WHERE id = ? AND user_id = ?',
      [historyId, userId]
    )
    if (row === undefined) {
      res.status(404).json({ error: '历史版本不存在' })
      return
    }
    const current = await get<{ version: number; data: string; updated_at: number }>(
      'SELECT version, data, updated_at FROM saves WHERE user_id = ?',
      [userId]
    )
    const now = Date.now()
    if (current !== undefined) {
      await run(
        'INSERT INTO save_history (user_id, version, data, realm_index, size, updated_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [userId, current.version, current.data, 0, current.data.length, current.updated_at, now]
      )
    }
    const started = row.data.includes('"started":true') ? 1 : 0
    await upsertByPk('saves', { user_id: userId, version: row.version, data: row.data, started, updated_at: now })
    res.json({ ok: true, updatedAt: now, fromHistoryId: historyId })
  })().catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
})

/* ---------------- VIP 激活码:批量生成 / 列表 / 删除 ---------------- */

/** 批量生成激活码:type = month(月) | half(半年) | year(年) | forever(永久);count 1~200 */
gmRouter.post('/codes/generate', requireAdmin, (req: Request, res: Response) => {
  void (async () => {
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>
    if (!isCodeType(body.type)) {
      res.status(400).json({ error: '类型无效' })
      return
    }
    const count = Math.floor(Number(body.count))
    if (!Number.isInteger(count) || count < 1 || count > 200) {
      res.status(400).json({ error: '数量须在 1~200 之间' })
      return
    }
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 60) : ''
    const days = CODE_TYPE_DAYS[body.type]
    const now = Date.now()
    const codes: string[] = []
    for (let i = 0; i < count; i++) {
      // 主键碰撞(概率可忽略)重试一次
      for (let attempt = 0; attempt < 2; attempt++) {
        const code = generateCode()
        try {
          await run('INSERT INTO vip_codes (code, days, note, created_at) VALUES (?, ?, ?, ?)', [code, days, note, now])
          codes.push(code)
          break
        } catch (err) {
          if (attempt === 1) throw err
        }
      }
    }
    res.json({ ok: true, codes, days })
  })().catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
})

/** 激活码列表:filter = all | unused | used;q 模糊匹配码面/备注 */
gmRouter.get('/codes', requireAdmin, (req: Request, res: Response) => {
  void (async () => {
    const filter = req.query.filter === 'unused' || req.query.filter === 'used' ? req.query.filter : 'all'
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toUpperCase() : ''
    const conds: string[] = []
    const params: unknown[] = []
    if (filter === 'unused') conds.push('c.used_by = 0')
    if (filter === 'used') conds.push('c.used_by != 0')
    if (q !== '') {
      conds.push('(c.code LIKE ? OR c.note LIKE ?)')
      params.push(`%${q}%`, `%${q}%`)
    }
    const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : ''
    const rows = await all<Record<string, unknown>>(
      `SELECT c.code, c.days, c.note, c.used_by, c.used_at, c.created_at, u.username AS used_name
       FROM vip_codes c
       LEFT JOIN users u ON u.id = c.used_by
       ${where}
       ORDER BY c.created_at DESC, c.code
       LIMIT 500`,
      params
    )
    res.json({
      codes: rows.map(r => ({
        code: r.code,
        days: r.days,
        note: r.note,
        usedBy: r.used_by !== 0 && r.used_by !== undefined ? r.used_by : 0,
        usedName: r.used_name ?? '',
        usedAt: r.used_at ?? 0,
        createdAt: r.created_at
      }))
    })
  })().catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
})

/** 删除激活码:仅未使用的可删(已使用的留作发放记录) */
gmRouter.delete('/codes/:code', requireAdmin, (req: Request, res: Response) => {
  void (async () => {
    const code = String(req.params.code).trim().toUpperCase()
    const result = await run('DELETE FROM vip_codes WHERE code = ? AND used_by = 0', [code])
    if (result.affectedRows === 0) {
      res.status(400).json({ error: '激活码不存在或已使用,不可删除' })
      return
    }
    res.json({ ok: true })
  })().catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
})

/** VIP 支付订单:最近 N 条(默认 100),含买家道号 */
gmRouter.get('/orders', requireAdmin, (req: Request, res: Response) => {
  void (async () => {
    const limit = Math.min(Math.max(Number(req.query.limit ?? 100) || 100, 1), 300)
    const rows = await all<Record<string, unknown>>(
      `SELECT o.out_trade_no, o.user_id, u.username, o.type, o.days, o.amount, o.status, o.created_at, o.paid_at
       FROM vip_orders o
       LEFT JOIN users u ON u.id = o.user_id
       ORDER BY o.created_at DESC
       LIMIT ?`,
      [limit]
    )
    res.json({
      orders: rows.map(r => ({
        outTradeNo: r.out_trade_no,
        userId: r.user_id,
        username: r.username ?? '',
        type: r.type,
        days: r.days,
        amount: r.amount,
        status: r.status,
        createdAt: r.created_at,
        paidAt: r.paid_at ?? 0
      }))
    })
  })().catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
})
