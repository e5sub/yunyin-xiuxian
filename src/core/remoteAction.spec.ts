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

import { reportAction, resyncFromCloud, runActionAwait } from './remoteAction'
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

/**
 * 登录态严格模式(1.79.8):钱货两讫的动作(坊市买入)在服务端 5xx/断网时
 * 不得退回 local —— 本地跑成的那一笔传不回云档,刷新即蒸发、货架还能再买。
 */
describe('等结果动作 · strict 登录态禁本地兜底', () => {
  beforeEach(() => {
    withWindow()
    setActivePinia(createPinia())
    actionOp.mockReset()
    actionResync.mockReset()
  })

  it('strict + 服务端 5xx:local 不跑,如实报失败', async () => {
    login(true)
    actionOp.mockRejectedValue(new Error('500 Internal Server Error'))
    const local = vi.fn(async () => 'ok' as const)
    const r = await runActionAwait('market_buy', { at: 1, index: 0 }, local, { strict: true })
    expect(r.ok).toBe(false)
    expect(local, '本地兜底会把幽灵成交做出来,严格模式下必须不跑').not.toHaveBeenCalled()
  })

  it('非 strict(默认)维持原口径:5xx 照旧走 local 保单机玩法', async () => {
    login(true)
    actionOp.mockRejectedValue(new Error('500 Internal Server Error'))
    const r = await runActionAwait('pill_use', {}, async () => 'local-done')
    expect(r.ok).toBe(true)
    expect(r.value).toBe('local-done')
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

describe('穿戴同步 · equip_set(1.79.7)', () => {
  beforeEach(() => {
    withWindow()
    setActivePinia(createPinia())
    actionOp.mockReset()
    actionResync.mockReset()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('穿戴后延迟上报整张 equipped 映射(带齐所有槽位)', async () => {
    login(true)
    const inv = useInventoryStore()
    inv.items = [
      { uid: 'w1', templateId: 'b_qingyun', quality: 'mortal', tier: 3, level: 0, affixes: [] },
      { uid: 'h1', templateId: 'b_qingyun', quality: 'mortal', tier: 3, level: 0, affixes: [] }
    ]
    inv.equip('w1', 'weapon')
    inv.equip('h1', 'head')
    // 未到期不发
    vi.advanceTimersByTime(200)
    expect(actionOp).not.toHaveBeenCalled()
    // 到期发一发,带齐全槽位快照
    vi.advanceTimersByTime(150)
    expect(actionOp).toHaveBeenCalledTimes(1)
    expect(actionOp.mock.calls[0]![0]).toMatchObject({ kind: 'equip_set' })
    const equipped = actionOp.mock.calls[0]![0].equipped
    expect(equipped.weapon).toBe('w1')
    expect(equipped.head).toBe('h1')
  })

  it('连换多件合并为一发:不撞服务端 250ms 闸门', () => {
    login(true)
    const inv = useInventoryStore()
    inv.items = ['w1', 'w2', 'h1'].map(uid => ({ uid, templateId: 'b_qingyun', quality: 'mortal', tier: 3, level: 0, affixes: [] }))
    // 连换三次(模拟一键换装),每次都会重置防抖时戳
    inv.equip('w1', 'weapon')
    vi.advanceTimersByTime(100)
    inv.equip('w2', 'weapon')
    vi.advanceTimersByTime(100)
    inv.equip('h1', 'head')
    vi.advanceTimersByTime(400)
    // 只发一发,且带的是最终快照(w2 而非被覆盖的 w1)
    expect(actionOp).toHaveBeenCalledTimes(1)
    const equipped = actionOp.mock.calls[0]![0].equipped
    expect(equipped.weapon).toBe('w2')
    expect(equipped.head).toBe('h1')
  })

  it('无窗口(服务端无头):不发任何请求', () => {
    vi.stubGlobal('window', undefined)
    login(true)
    const inv = useInventoryStore()
    inv.items = [{ uid: 'w1', templateId: 'b_qingyun', quality: 'mortal', tier: 3, level: 0, affixes: [] }]
    inv.equip('w1', 'weapon')
    vi.advanceTimersByTime(500)
    expect(actionOp).not.toHaveBeenCalled()
  })

  it('卸下也触发整张映射上报(该槽位消失)', () => {
    login(true)
    const inv = useInventoryStore()
    inv.items = [{ uid: 'w1', templateId: 'b_qingyun', quality: 'mortal', tier: 3, level: 0, affixes: [] }]
    inv.equip('w1', 'weapon')
    vi.advanceTimersByTime(400)
    actionOp.mockClear()
    inv.unequip('weapon')
    vi.advanceTimersByTime(400)
    expect(actionOp).toHaveBeenCalledTimes(1)
    expect(actionOp.mock.calls[0]![0].equipped.weapon).toBeUndefined()
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
