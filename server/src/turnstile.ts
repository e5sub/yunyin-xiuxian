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

/** 「开关开着但密钥不全」只提醒一次(每次请求都打会把日志刷满) */
let warnedIncomplete = false

export async function turnstileConfig(): Promise<TurnstileConfig> {
  const [enabledRaw, siteKey, secret] = await Promise.all([
    getConfig('turnstile_enabled'),
    getConfig('turnstile_site_key'),
    getConfig('turnstile_secret_key')
  ])
  const site = siteKey.trim()
  const key = secret.trim()
  const on = enabledRaw === 'true'
  // 开关开着但密钥不全:前端拿不到站点密钥就不渲染,这里也就一直放行。
  // 静默最坑人(后台看着是开的),首次遇上打一行日志,补上密钥后自动复位。
  if (on && (site === '' || key === '')) {
    if (!warnedIncomplete) {
      warnedIncomplete = true
      console.warn('[turnstile] 开关已开,但站点密钥/私钥没填全 —— 登录页不会出现验证框,也不会拦截。请在 GM 后台补齐两把密钥。')
    }
  } else {
    warnedIncomplete = false
  }
  return { enabled: on && site !== '' && key !== '', siteKey: site, secret: key }
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
