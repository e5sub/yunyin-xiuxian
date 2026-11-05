/** JWT 密钥:优先 env,否则生成并落盘复用(重启不失效) */
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const dataDir = join(here, '..', 'data')
mkdirSync(dataDir, { recursive: true })

const secretFile = join(dataDir, 'jwt-secret')

/** 进程内只解析一次:jwtSecret 在每个鉴权请求都会被调,不能每次同步读盘;
 * 兜底密钥也只生成一次 —— 每次调用都 randomBytes 会让「刚签的 token 紧接着就验不过」 */
let cachedSecret: string | null = null

export function jwtSecret(): string {
  if (cachedSecret !== null) return cachedSecret
  const fromEnv = process.env.YUNYIN_JWT_SECRET
  if (fromEnv && fromEnv.length >= 16) return (cachedSecret = fromEnv)
  try {
    if (existsSync(secretFile)) {
      const saved = readFileSync(secretFile, 'utf8').trim()
      if (saved.length >= 16) return (cachedSecret = saved)
    }
    const generated = randomBytes(32).toString('hex')
    writeFileSync(secretFile, generated, { mode: 0o600 })
    return (cachedSecret = generated)
  } catch {
    // 只读文件系统兜底:进程内随机,重启后所有 token 失效
    return (cachedSecret = randomBytes(32).toString('hex'))
  }
}
