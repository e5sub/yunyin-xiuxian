/** JWT 密钥:优先 env,否则生成并落盘复用(重启不失效) */
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const dataDir = join(here, '..', 'data')
mkdirSync(dataDir, { recursive: true })

const secretFile = join(dataDir, 'jwt-secret')

export function jwtSecret(): string {
  const fromEnv = process.env.YUNYIN_JWT_SECRET
  if (fromEnv && fromEnv.length >= 16) return fromEnv
  try {
    if (existsSync(secretFile)) {
      const saved = readFileSync(secretFile, 'utf8').trim()
      if (saved.length >= 16) return saved
    }
    const generated = randomBytes(32).toString('hex')
    writeFileSync(secretFile, generated, { mode: 0o600 })
    return generated
  } catch {
    // 只读文件系统兜底:进程内随机,重启后所有 token 失效
    return randomBytes(32).toString('hex')
  }
}
