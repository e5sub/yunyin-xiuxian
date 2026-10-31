/**
 * Cloudflare Turnstile 人机验证(注册/找回口令/发验证码等敏感口)。
 * 密钥走 game_config:turnstile_enabled / turnstile_site_key / turnstile_secret_key(GM 后台可改)。
 * 未启用或密钥不全 → 一律放行(本地开发无需配置);启用后验证失败/超时一律拒绝(fail closed)。
 */
import { getConfig } from './config.js'

export interface TurnstileConfig {
  enabled: boolean
  siteKey: string
  secret: string
}

export async function turnstileConfig(): Promise<TurnstileConfig> {
  const [enabledRaw, siteKey, secret] = await Promise.all([
    getConfig('turnstile_enabled'),
    getConfig('turnstile_site_key'),
    getConfig('turnstile_secret_key')
  ])
  const site = siteKey.trim()
  const key = secret.trim()
  return { enabled: enabledRaw === 'true' && site !== '' && key !== '', siteKey: site, secret: key }
}

/** 校验一个 Turnstile token;ip 仅用于 Cloudflare 侧记录(拿不到也不影响判定) */
export async function verifyTurnstile(token: unknown, ip: string): Promise<boolean> {
  const cfg = await turnstileConfig()
  if (!cfg.enabled) return true
  if (typeof token !== 'string' || token.trim() === '') return false
  try {
    const body = new URLSearchParams({ secret: cfg.secret, response: token.trim() })
    if (ip.trim() !== '') body.set('remoteip', ip.trim())
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(5000)
    })
    const j = (await r.json()) as { success?: boolean }
    return j.success === true
  } catch {
    // Cloudflare 不可达也拒:人机验证开启就意味着宁可误伤不可放行
    return false
  }
}
