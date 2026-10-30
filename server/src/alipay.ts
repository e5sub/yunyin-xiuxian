/**
 * 支付宝开放平台最小客户端:当面付两条接口(预下单 trade.precreate + 查单 trade.query)。
 * RSA2 签名/验签用 node:crypto 手写,不引官方 SDK(部署轻、无传递依赖)。
 * 密钥与开关全部来自 game_config(GM 后台「支付宝当面付」页配置)。
 */
import { createSign, createVerify } from 'node:crypto'
import { allConfig } from './config.js'

const GATEWAY = 'https://openapi.alipay.com/gateway.do'

export interface AlipayConfig {
  appId: string
  merchantKey: string
  alipayPublicKey: string
}

/** 读支付配置;未开启或缺任一密钥返回 null */
export async function alipayConfig(): Promise<AlipayConfig | null> {
  const cfg = await allConfig()
  if (cfg.alipay_enabled !== 'true') return null
  const appId = (cfg.alipay_app_id ?? '').trim()
  const merchantKey = normalizePrivateKey(cfg.alipay_merchant_private_key ?? '')
  const alipayPublicKey = normalizePublicKey(cfg.alipay_alipay_public_key ?? '')
  if (appId === '' || merchantKey === null || alipayPublicKey === null) return null
  return { appId, merchantKey, alipayPublicKey }
}

/**
 * 密钥归一:容忍 GM 粘贴的多种形态(单行裸 base64 / 带 PEM 头 / 字面 \n)。
 * 支付宝密钥工具导出为 PKCS8,统一按 PKCS8 包头重排;公钥为 X.509。
 */
function normalizeBase64(raw: string): string | null {
  const body = raw
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '')
  if (body === '' || !/^[A-Za-z0-9+/=]+$/.test(body)) return null
  return (body.match(/.{1,64}/g) ?? []).join('\n')
}

function normalizePrivateKey(raw: string): string | null {
  const body = normalizeBase64(raw)
  return body === null ? null : `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----`
}

function normalizePublicKey(raw: string): string | null {
  const body = normalizeBase64(raw)
  return body === null ? null : `-----BEGIN PUBLIC KEY-----\n${body}\n-----END PUBLIC KEY-----`
}

/** 网关要求北京时间(yyyy-MM-dd HH:mm:ss) */
function bjTimestamp(): string {
  return new Date(Date.now() + 8 * 3_600_000).toISOString().replace('T', ' ').slice(0, 19)
}

/** RSA2 签名:按 key ASCII 升序拼 key=value&,空值与 sign 本身不参与 */
function signParams(params: Record<string, string>, merchantKey: string): string {
  const toSign = Object.keys(params)
    .filter(k => k !== 'sign' && params[k] !== '')
    .sort()
    .map(k => `${k}=${params[k]}`)
    .join('&')
  return createSign('RSA-SHA256').update(toSign, 'utf8').sign(merchantKey, 'base64')
}

/** 响应验签:取 *_response 节点重序列化(网关返回紧凑 JSON,键序保留)后用支付宝公钥验证 */
function verifyResponse(body: Record<string, unknown>, alipayPublicKey: string): boolean {
  const sign = body.sign
  const key = Object.keys(body).find(k => k.endsWith('_response') && k !== 'error_response')
  if (key === undefined || typeof sign !== 'string') return false
  const toVerify = JSON.stringify(body[key])
  return createVerify('RSA-SHA256').update(toVerify, 'utf8').verify(alipayPublicKey, sign, 'base64')
}

async function callGateway(params: Record<string, string>): Promise<Record<string, unknown> | null> {
  const resp = await fetch(GATEWAY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(10_000)
  })
  if (!resp.ok) return null
  return (await resp.json()) as Record<string, unknown>
}

export interface PrecreateResult {
  ok: boolean
  qrCode?: string
  error?: string
}

/** 预下单:返回二维码内容串(qr.alipay.com/...) */
export async function tradePrecreate(
  cfg: AlipayConfig,
  outTradeNo: string,
  totalAmount: string,
  subject: string
): Promise<PrecreateResult> {
  let params: Record<string, string>
  try {
    params = {
      app_id: cfg.appId,
      method: 'alipay.trade.precreate',
      format: 'JSON',
      charset: 'utf-8',
      sign_type: 'RSA2',
      timestamp: bjTimestamp(),
      version: '1.0',
      biz_content: JSON.stringify({
        out_trade_no: outTradeNo,
        total_amount: totalAmount,
        subject,
        timeout_express: '15m'
      })
    }
    params.sign = signParams(params, cfg.merchantKey)
  } catch {
    // 密钥格式坏(非 PKCS8 base64 等)
    return { ok: false, error: '支付配置无效:商户私钥不可用,请检查 GM 后台密钥设置' }
  }
  let body: Record<string, unknown> | null
  try {
    body = await callGateway(params)
  } catch {
    return { ok: false, error: '支付网关不可达' }
  }
  let verified = false
  try {
    verified = body !== null && verifyResponse(body, cfg.alipayPublicKey)
  } catch {
    verified = false
  }
  if (!verified) {
    return { ok: false, error: '支付网关响应验签失败(请核对支付宝公钥配置)' }
  }
  const r = body!.alipay_trade_precreate_response as { code?: string; sub_msg?: string; msg?: string; qr_code?: string }
  if (r?.code !== '10000' || typeof r.qr_code !== 'string') {
    return { ok: false, error: r?.sub_msg ?? r?.msg ?? '下单失败' }
  }
  return { ok: true, qrCode: r.qr_code }
}

export interface QueryResult {
  /** unknown = 网关异常/交易不存在等,订单保持 pending 下轮再查 */
  status: 'paid' | 'waiting' | 'closed' | 'unknown'
  amount?: string
  error?: string
}

/** 查单:以支付宝侧交易状态为准 */
export async function tradeQuery(cfg: AlipayConfig, outTradeNo: string): Promise<QueryResult> {
  let params: Record<string, string>
  try {
    params = {
      app_id: cfg.appId,
      method: 'alipay.trade.query',
      format: 'JSON',
      charset: 'utf-8',
      sign_type: 'RSA2',
      timestamp: bjTimestamp(),
      version: '1.0',
      biz_content: JSON.stringify({ out_trade_no: outTradeNo })
    }
    params.sign = signParams(params, cfg.merchantKey)
  } catch {
    return { status: 'unknown', error: '支付配置无效:商户私钥不可用' }
  }
  let body: Record<string, unknown> | null
  try {
    body = await callGateway(params)
  } catch {
    return { status: 'unknown', error: '支付网关不可达' }
  }
  let verified = false
  try {
    verified = body !== null && verifyResponse(body, cfg.alipayPublicKey)
  } catch {
    verified = false
  }
  if (!verified) {
    return { status: 'unknown', error: '支付网关响应验签失败' }
  }
  const r = body!.alipay_trade_query_response as {
    code?: string
    sub_msg?: string
    msg?: string
    trade_status?: string
    total_amount?: string
  }
  // 40004 = 交易不存在(还没人扫码)
  if (r?.code === '40004') return { status: 'waiting' }
  if (r?.code !== '10000') {
    return { status: 'unknown', error: r?.sub_msg ?? r?.msg ?? '查单失败' }
  }
  const st = r.trade_status ?? ''
  if (st === 'TRADE_SUCCESS' || st === 'TRADE_FINISHED') {
    return { status: 'paid', amount: r.total_amount }
  }
  if (st === 'TRADE_CLOSED') return { status: 'closed' }
  return { status: 'waiting' }
}
