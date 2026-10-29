/**
 * 邮件发送:验证码(注册预留 / 找回密码)
 * 全部设置读 game_config(GM 后台「邮件 / SMTP」页可改,30 秒缓存):
 *   email_enabled=true 开启 SMTP 实发;未开启时验证码只打到控制台(联调用),响应带 devCode
 *   smtp_host / smtp_port / smtp_user / smtp_pass / smtp_from
 * 老部署的环境变量(EMAIL_ENABLED / SMTP_*)仅作首次建库种子值
 */
import { randomInt } from 'node:crypto'
import { getConfig } from './config.js'

type Transport = { sendMail(opts: Record<string, unknown>): Promise<unknown> }

export interface SmtpSettings {
  enabled: boolean
  host: string
  port: number
  user: string
  pass: string
  from: string
}

const SETTING_KEYS = ['email_enabled', 'smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_from'] as const

export async function smtpSettings(): Promise<SmtpSettings> {
  const v = await Promise.all(SETTING_KEYS.map(k => getConfig(k)))
  return {
    enabled: v[0] === 'true',
    host: v[1] ?? '',
    port: Number(v[2] ?? '') || 465,
    user: v[3] ?? '',
    pass: v[4] ?? '',
    from: v[5] ?? ''
  }
}

export async function emailEnabled(): Promise<boolean> {
  return (await smtpSettings()).enabled
}

let transport: Transport | null = null
let transportKey = ''

async function getTransport(s: SmtpSettings): Promise<Transport> {
  const key = `${s.host}|${s.port}|${s.user}|${s.pass}`
  if (transport !== null && transportKey === key) return transport
  const mod = await import('nodemailer')
  const nodemailer = (mod.default ?? mod) as unknown as {
    createTransport(opts: Record<string, unknown>): Transport
  }
  transport = nodemailer.createTransport({
    host: s.host,
    port: s.port,
    secure: s.port === 465,
    auth: s.user ? { user: s.user, pass: s.pass } : undefined
  })
  transportKey = key
  return transport
}

export function makeCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

const PURPOSE_TEXT: Record<string, string> = {
  register: '注册',
  reset: '找回密码'
}

/** 发验证码;SMTP 未配置或发送失败时打控制台(不抛错,联调不受阻) */
export async function sendCodeMail(email: string, code: string, purpose: string): Promise<boolean> {
  const s = await smtpSettings()
  const subject = `【云隐修仙录】${PURPOSE_TEXT[purpose] ?? '验证'}验证码:${code}`
  const text = `您的验证码是 ${code},10 分钟内有效。若非本人操作请忽略。`
  if (!s.enabled || s.host === '') {
    console.log(`[mail] 未启用 SMTP,验证码打到控制台 -> ${email} ${subject}`)
    return false
  }
  try {
    const t = await getTransport(s)
    await t.sendMail({
      from: s.from || s.user,
      to: email,
      subject,
      text
    })
    return true
  } catch (e) {
    console.error('[mail] 发送失败,验证码打到控制台', e instanceof Error ? e.message : e)
    return false
  }
}

/** 发一封测试邮件(GM 后台「发送测试邮件」用);返回错误信息,null=成功 */
export async function sendTestMail(to: string): Promise<string | null> {
  const s = await smtpSettings()
  if (!s.enabled || s.host === '') return '邮箱服务未开启或未填 SMTP 服务器'
  try {
    const t = await getTransport(s)
    await t.sendMail({
      from: s.from || s.user,
      to,
      subject: '【云隐修仙录】SMTP 测试邮件',
      text: '这是一封测试邮件,收到即说明 SMTP 设置生效。'
    })
    return null
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}
