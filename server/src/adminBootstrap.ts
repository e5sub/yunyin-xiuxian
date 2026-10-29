/** 管理员账号引导:env(GM_USER/GM_PASS)与 npm run admin 脚本共用同一套逻辑 */
import bcrypt from 'bcryptjs'
import { get, run } from './db.js'

/**
 * 创建或提升管理员。
 * - 已存在同名账号:提升为 admin 并解封;password 给出时同步重置口令
 * - 不存在:必须提供口令(6~64 字)才能创建
 * 返回用于运行日志的描述文本;参数不合法时抛错。
 */
export async function ensureAdminUser(username: string, password = ''): Promise<string> {
  const name = username.trim()
  if (name === '') throw new Error('GM 用户名不能为空')
  const lower = name.toLowerCase()
  const existing = await get<{ id: number }>('SELECT id FROM users WHERE username_lower = ?', [lower])
  if (existing !== undefined) {
    if (password !== '') {
      if (password.length < 6 || password.length > 64) throw new Error('GM 口令须 6~64 字')
      await run('UPDATE users SET role = ?, status = ?, pass_hash = ? WHERE id = ?', [
        'admin',
        'active',
        bcrypt.hashSync(password, 10),
        existing.id
      ])
      return `管理员「${name}」(id=${existing.id})已存在,口令已按 GM_PASS 重置`
    }
    await run("UPDATE users SET role = 'admin', status = 'active' WHERE id = ?", [existing.id])
    return `管理员「${name}」(id=${existing.id})已存在,保持口令不变`
  }
  if (password === '') throw new Error('新管理员必须提供 GM_PASS(6~64 字)')
  if (password.length < 6 || password.length > 64) throw new Error('GM 口令须 6~64 字')
  const info = await run(
    'INSERT INTO users (username, username_lower, email, email_lower, pass_hash, role, status, created_at) VALUES (?, ?, NULL, NULL, ?, ?, ?, ?)',
    [name, lower, bcrypt.hashSync(password, 10), 'admin', 'active', Date.now()]
  )
  return `管理员「${name}」已创建 (id=${info.insertId})`
}
