/** 创建/提升管理员:npm run admin -- <道号> <口令>;已存在同名玩家则提升为 admin */
import bcrypt from 'bcryptjs'
import { initDb, get, run } from '../db.js'

async function main(): Promise<void> {
  const [username, password] = process.argv.slice(2)
  if (!username || !password || password.length < 6) {
    console.error('用法: npm run admin -- <道号> <口令(6~64字)>')
    process.exit(1)
  }
  await initDb()
  const lower = username.toLowerCase()
  const existing = await get<{ id: number }>('SELECT id FROM users WHERE username_lower = ?', [lower])
  if (existing !== undefined) {
    await run("UPDATE users SET role = 'admin', status = 'active' WHERE id = ?", [existing.id])
    console.log(`已将「${username}」(id=${existing.id})提升为管理员`)
    return
  }
  const info = await run(
    'INSERT INTO users (username, username_lower, email, email_lower, pass_hash, role, status, created_at) VALUES (?, ?, NULL, NULL, ?, ?, ?, ?)',
    [username, lower, bcrypt.hashSync(password, 10), 'admin', 'active', Date.now()]
  )
  console.log(`管理员「${username}」已创建 (id=${info.insertId})`)
  process.exit(0)
}

main()
  .then(() => process.exit(0))
  .catch(e => {
    console.error(e)
    process.exit(1)
  })
