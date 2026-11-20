/**
 * 动作上报 —— 客户端那一侧的判据(src/core/remoteAction)。
 *
 * 上报是「尽力而为」的旁路:动作已在本地跑完,界面不该被它挂住,更不该被它带崩。
 * 判据四件事:
 *   · 未登录 / 无窗口一律不发(服务端无头跑结算时会调到这里,不能再发 HTTP);
 *   · 成功:按回传的键级分片 $patch 回本地(服务端那份才是真的);
 *   · 被拒(ok=false):本地那次预测作废 —— 拉云档重对齐;
 *   · 上报链路自身抛错不得冒到调用方。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const actionOp = vi.fn()
const actionResync = vi.fn()

vi.mock('@/services/cloud', async importOriginal => {
  const mod = await importOriginal<typeof import('@/services/cloud')>()
  return {
    ...mod,
    cloudApi: { ...mod.cloudApi, actionOp: (...a: unknown[]) => actionOp(...a), actionResync: () => actionResync() }
  }
})

import { reportAction, resyncFromCloud } from './remoteAction'
import { useAuthStore } from '@/stores/auth'
import { useInventoryStore } from '@/stores/inventory'
import { useResourcesStore } from '@/stores/resources'

/**
 * jsdom 不在本仓默认环境里:上报模块按 `typeof window` 判「客户端还是服务端」,
 * 这里显式给一个 window,测的才是浏览器那条路(服务端那条路由「未登录不发」间接覆盖)。
 */
function withWindow(): void {
  vi.stubGlobal('window', {})
}

afterEach(() => {
  vi.unstubAllGlobals()
})

/** `loggedIn` 是 computed(token && userId>0),只能从这两项造出登录态 */
function login(loggedIn: boolean): void {
  const auth = useAuthStore()
  auth.token = loggedIn ? 'test-token' : ''
  auth.userId = loggedIn ? 1 : 0
}

const flush = (): Promise<void> => new Promise(r => setTimeout(r, 0))

describe('动作上报 · 什么时候不发', () => {
  beforeEach(() => {
    withWindow()
    setActivePinia(createPinia())
    actionOp.mockReset()
    actionResync.mockReset()
  })

  it('未登录:返回 false,一个请求都不发', () => {
    login(false)
    expect(reportAction('pill_use', { id: 'p_jvqidan' })).toBe(false)
    expect(actionOp).not.toHaveBeenCalled()
  })
})

describe('动作上报 · 成功与被拒', () => {
  beforeEach(() => {
    withWindow()
    setActivePinia(createPinia())
    actionOp.mockReset()
    actionResync.mockReset()
  })

  it('成功:把回传的分片 patch 回本地', async () => {
    login(true)
    actionOp.mockResolvedValue({ ok: true, slices: { resources: { ore: 42 } } })
    expect(reportAction('sell_material')).toBe(true)
    await flush()
    expect(useResourcesStore().ore).toBe(42)
  })

  it('被拒:本地预测作废,拉云档重对齐', async () => {
    login(true)
    actionOp.mockResolvedValue({ ok: false, reason: '囊中无此丹', slices: {} })
    actionResync.mockResolvedValue({ ok: true, slices: { inventory: { pills: { p_jvqidan: 3 } } } })
    const seen: string[] = []
    reportAction('pill_use', { id: 'p_jvqidan' }, r => seen.push(r.ok ? 'ok' : (r.reason ?? '')))
    await flush()
    expect(seen).toEqual(['囊中无此丹'])
    expect(actionResync).toHaveBeenCalledTimes(1)
    expect(useInventoryStore().pills.p_jvqidan).toBe(3)
  })

  it('网络失败:回调拿到原因,但不重放(重放会把一次动作做成两次)', async () => {
    login(true)
    actionOp.mockRejectedValue(new Error('网络不通'))
    const seen: string[] = []
    reportAction('pill_use', { id: 'p_jvqidan' }, r => seen.push(r.ok ? 'ok' : (r.reason ?? '')))
    await flush()
    expect(seen).toEqual(['网络不通'])
    expect(actionOp).toHaveBeenCalledTimes(1)
    expect(actionResync).not.toHaveBeenCalled()
  })
})

describe('重对齐 · 单飞', () => {
  beforeEach(() => {
    withWindow()
    setActivePinia(createPinia())
    actionResync.mockReset()
  })

  it('并发调用只拉一次整档', async () => {
    actionResync.mockResolvedValue({ ok: true, slices: { resources: { ore: 7 } } })
    await Promise.all([resyncFromCloud(), resyncFromCloud(), resyncFromCloud()])
    expect(actionResync).toHaveBeenCalledTimes(1)
    expect(useResourcesStore().ore).toBe(7)
  })
})
