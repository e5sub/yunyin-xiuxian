/**
 * 会话失效统一下线:401(kicked/session)与 403(banned,账号封禁)都要触发 onSessionEnd。
 * 封禁是「服务端不再收任何请求」,客户端收到后同样下线并停止云上传;两类 401 的最后一推语义不在本文件(在 App.vue)。
 * 另钉一条:未登录时收到 banned(登录接口试封禁号也会拿到)不走下线流程,登录页自己亮错误。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { CloudError, cloudApi, onSessionEnd } from './cloud'
import { useAuthStore } from '@/stores/auth'

function jsonRes(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/** 统一下线的防重入是 3 秒真实定时器,用假时钟在用例间放行 */
describe('会话失效统一下线(banned / kicked)', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let reasons: string[]

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    setActivePinia(createPinia())
    reasons = []
    onSessionEnd(reason => {
      reasons.push(reason)
    })
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.advanceTimersByTime(3000)
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('已登录玩家收到 403 banned:触发下线,错误照抛(code 可读)', async () => {
    useAuthStore().$patch({ token: 'tok', userId: 1, username: '道号' })
    fetchMock.mockResolvedValueOnce(jsonRes(403, { error: '账号已被封禁', code: 'banned' }))
    const err = await cloudApi.me().catch((e: unknown) => e as CloudError)
    expect(err, 'me() 应当报错').toBeInstanceOf(CloudError)
    expect((err as CloudError).code).toBe('banned')
    expect((err as CloudError).status).toBe(403)
    expect(reasons).toEqual(['banned'])
  })

  it('挤下线(401 kicked)照旧触发,不受封禁改动影响', async () => {
    useAuthStore().$patch({ token: 'tok', userId: 1, username: '道号' })
    fetchMock.mockResolvedValueOnce(jsonRes(401, { error: '账号已在其他设备登录', code: 'kicked' }))
    await expect(cloudApi.me()).rejects.toMatchObject({ code: 'kicked' })
    expect(reasons).toEqual(['kicked'])
  })

  it('401 回来时 token 已换(改密/重登):只抛错,不把新会话踢下线', async () => {
    useAuthStore().$patch({ token: 'old-token', userId: 1, username: '道号' })
    // 请求在途时换了凭证(改密接口返回新 token 后本地替换)
    fetchMock.mockImplementationOnce(async () => {
      useAuthStore().$patch({ token: 'new-token' })
      return jsonRes(401, { error: '登录已失效', code: 'session' })
    })
    await expect(cloudApi.me()).rejects.toMatchObject({ code: 'session' })
    expect(reasons, '失效的是旧 token,新会话不该被统一下线').toEqual([])
  })

  it('未登录时收到 banned(如登录接口试封禁号):不走下线流程', async () => {
    expect(useAuthStore().token).toBe('')
    fetchMock.mockResolvedValueOnce(jsonRes(403, { error: '账号已被封禁', code: 'banned' }))
    await expect(cloudApi.login('封禁号', 'pw')).rejects.toMatchObject({ code: 'banned' })
    expect(reasons, '没有会话就没有「下线」可言').toEqual([])
  })
})
