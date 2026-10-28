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

/** GM 后台改参;写入后立即失效缓存 */
export async function setConfig(key: string, value: string): Promise<void> {
  await run(
    'UPDATE game_config SET config_value = ?, updated_at = ? WHERE config_key = ?',
    [value, Date.now(), key]
  )
  fetchedAt = 0
}
