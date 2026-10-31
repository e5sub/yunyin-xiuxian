/**
 * Cloudflare Turnstile 显式渲染挂件(登录页注册/找回口令用)。
 * 站点密钥由 /auth/config 下发;未启用时所有函数都是空操作。
 * token 单次有效:每消费一次须 reset() 重挂,拿新的。
 */

interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string
  reset: (id?: string) => void
  remove: (id: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

/** 脚本多久不来就当挂了:Cloudflare 在部分网络下会被拦成「一直转圈不报错」,不设上限等于永远留白 */
const SCRIPT_TIMEOUT_MS = 12_000

/**
 * 起不来的三类原因,给界面的说法不一样:
 * csp = 站点响应头的 Content-Security-Policy 没放行本域(改 nginx/面板即可,不是玩家的问题);
 * network = 网络拦截/扩展拦插件;timeout = 拉得动但迟迟不回。
 */
export type TurnstileFail = 'csp' | 'network' | 'timeout'

export class TurnstileError extends Error {
  readonly reason: TurnstileFail

  constructor(reason: TurnstileFail, message: string) {
    super(message)
    this.name = 'TurnstileError'
    this.reason = reason
  }
}

let siteKey = ''
let scriptLoading: Promise<TurnstileApi> | null = null
/** 本轮加载期间是否收到过针对本脚本的 CSP 拦截报告(CSP 拦下时元素同样只报一个笼统的 error 事件) */
let cspBlocked = false

interface Widget {
  id: string
  token: string
}

const widgets = new Map<HTMLElement, Widget>()

export function configureTurnstile(key: string): void {
  siteKey = key.trim()
}

export function turnstileEnabled(): boolean {
  return siteKey !== ''
}

function loadScript(): Promise<TurnstileApi> {
  if (window.turnstile !== undefined) return Promise.resolve(window.turnstile)
  if (scriptLoading !== null) return scriptLoading
  cspBlocked = false
  // CSP 拦下脚本时,元素上只有一个笼统的 error 事件;CSP 报告才带得出「被哪条规则拦了」
  const onViolation = (e: SecurityPolicyViolationEvent): void => {
    if (e.blockedURI.includes('challenges.cloudflare.com')) cspBlocked = true
  }
  document.addEventListener('securitypolicyviolation', onViolation)
  scriptLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    let settled = false
    /** 失败一律走这里:清掉缓存的 promise,重试才不会一直拿到同一个 rejected */
    const fail = (reason: TurnstileFail, msg: string): void => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      document.removeEventListener('securitypolicyviolation', onViolation)
      scriptLoading = null
      s.remove()
      reject(new TurnstileError(reason, msg))
    }
    const timer = window.setTimeout(() => fail('timeout', 'Turnstile 加载超时'), SCRIPT_TIMEOUT_MS)
    s.src = SCRIPT_SRC
    s.async = true
    s.defer = true
    s.onload = () => {
      if (window.turnstile === undefined) {
        fail('network', 'Turnstile 加载失败')
        return
      }
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      document.removeEventListener('securitypolicyviolation', onViolation)
      resolve(window.turnstile)
    }
    s.onerror = () => {
      // CSP 拦截与网络失败在元素上都表现成 error;有 CSP 报告就按 CSP 说,免得让人去查网络
      if (cspBlocked) fail('csp', '站点 CSP 拦下了 Turnstile 脚本')
      else fail('network', 'Turnstile 加载失败')
    }
    document.head.appendChild(s)
  })
  return scriptLoading
}

/** 把挂件渲染进容器(重复调用先移除旧的);渲染完成即开始无声判定 */
export async function renderTurnstile(el: HTMLElement): Promise<void> {
  if (siteKey === '') return
  const ts = await loadScript()
  removeTurnstile(el)
  const w: Widget = { id: '', token: '' }
  w.id = ts.render(el, {
    sitekey: siteKey,
    theme: 'auto',
    callback: (token: string) => {
      w.token = token
    },
    'expired-callback': () => {
      w.token = ''
    },
    'error-callback': () => {
      w.token = ''
    }
  })
  widgets.set(el, w)
}

export function turnstileToken(el: HTMLElement): string {
  return widgets.get(el)?.token ?? ''
}

/** 消费后重置(token 单次有效),过期/出错也走这里重挂 */
export function resetTurnstile(el: HTMLElement): void {
  const w = widgets.get(el)
  if (w === undefined) return
  w.token = ''
  window.turnstile?.reset(w.id)
}

export function removeTurnstile(el: HTMLElement): void {
  const w = widgets.get(el)
  if (w === undefined) return
  window.turnstile?.remove(w.id)
  widgets.delete(el)
}
