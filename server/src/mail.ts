/**
 * 邮件发送:验证码(注册预留 / 找回密码)
 * env:
 *   EMAIL_ENABLED=true 开启 SMTP 实发;未开启时验证码只打到控制台(联调用),响应带 devCode
 *   SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / SMTP_FROM
 */
import { randomInt } from 'node:crypto'

type Transport = { sendMail(opts: Record<string, unknown>): Promise<unknown> }

let transport: Transport | null = null

export function emailEnabled(): boolean {
  return process.env.EMAIL_ENABLED === 'true'
}

async function getTransport(): Promise<Transport> {
  if (transport !== null) return transport
  const mod = await import('nodemailer')
  const nodemailer = (mod.default ?? mod) as unknown as {
    createTransport(opts: Record<string, unknown>): Transport
  }
  const port = Number(process.env.SMTP_PORT ?? 465)
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined
  })
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
  const subject = `【云隐修仙录】${PURPOSE_TEXT[purpose] ?? '验证'}验证码:${code}`
  const text = `您的验证码是 ${code},10 分钟内有效。若非本人操作请忽略。`
  if (!emailEnabled() || !process.env.SMTP_HOST) {
    console.log(`[mail] 未启用 SMTP,验证码打到控制台 -> ${email} ${subject}`)
    return false
  }
  try {
    const t = await getTransport()
    await t.sendMail({
      from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
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
