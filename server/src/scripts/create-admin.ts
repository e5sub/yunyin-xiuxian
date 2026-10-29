/** 创建/提升管理员:npm run admin -- <道号> <口令>;已存在同名玩家则提升为 admin */
import { initDb } from '../db.js'
import { ensureAdminUser } from '../adminBootstrap.js'

async function main(): Promise<void> {
  const [username, password] = process.argv.slice(2)
  if (!username || !password) {
    console.error('用法: npm run admin -- <道号> <口令(6~64字)>')
    process.exit(1)
  }
  await initDb()
  try {
    console.log(await ensureAdminUser(username, password))
  } catch (e) {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  }
}

main()
  .then(() => process.exit(0))
  .catch(e => {
    console.error(e)
    process.exit(1)
  })
