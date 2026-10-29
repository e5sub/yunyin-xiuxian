/**
 * 游戏关键参数(game_config 表)读取缓存
 * ws 网关与 REST 共用;缓存 30 秒,GM 改参最迟 30 秒生效
 */
import { all, run } from './db.js'

const CACHE_TTL_MS = 30_000

let cache: Map<string, string> = new Map()
let fetchedAt = 0

async function refresh(): Promise<void> {
  if (Date.now() - fetchedAt < CACHE_TTL_MS) return
  const rows = await all<{ config_key: string; config_value: string }>(
    'SELECT config_key, config_value FROM game_config'
  )
  const next = new Map<string, string>()
  for (const r of rows) next.set(r.config_key, r.config_value)
  cache = next
  fetchedAt = Date.now()
}

export async function getConfig(key: string, fallback = ''): Promise<string> {
  await refresh()
  return cache.get(key) ?? fallback
}

export async function getConfigNumber(key: string, fallback: number): Promise<number> {
  const v = await getConfig(key, String(fallback))
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

export async function allConfig(): Promise<Record<string, string>> {
  await refresh()
  return Object.fromEntries(cache)
}

/** GM 后台改参;写入后立即失效缓存。
 *  必须是 upsert 而不是 UPDATE:配置行不存在时(老库没跑到该键的种子)UPDATE 影响 0 行,
 *  表现就是「保存成功,刷新后字段空白,且永远不生效」。 */
export async function setConfig(key: string, value: string): Promise<void> {
  await run('REPLACE INTO game_config (config_key, config_value, updated_at) VALUES (?, ?, ?)', [
    key,
    value,
    Date.now()
  ])
  fetchedAt = 0
}
