/**
 * 登录回跳目标的白名单化:只认站内绝对路径。
 *
 * 由 `router.beforeEach` 把原目标写进 `?redirect=`,登录成功后回跳。两条必须挡:
 * - `//evil.com` / `https://…`:浏览器会把前者当协议相对外链,是开放重定向;
 * - `/login`:回跳自己会形成循环(已登录守卫又会把它送回 login)。
 * 纯函数、不碰 router 实例,便于直测。
 */
export function safeRedirect(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  if (!raw.startsWith('/') || raw.startsWith('//')) return ''
  return raw === '/login' || raw.startsWith('/login?') ? '' : raw
}
