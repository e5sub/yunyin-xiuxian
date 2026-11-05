/**
 * 本地档按账号隔离(1.62.0)的回归判据。
 * 这些键一旦错位不会立刻报错,只会表现成「换号后上传一直 409」「离线进度被云端悄悄覆盖」
 * 「清档把别的账号一起清了」—— 都必须在读档前就把键钉对,故单独成 spec。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  accountStorageKey,
  clearAllSave,
  currentAccountScope,
  initAccountScope,
  setAccountScope
} from './storage'

/** 可控的 localStorage:可选让指定前缀的 removeItem 静默失效(模拟部分 WebView) */
function installStorage(failRemovePrefix?: string): Map<string, string> {
  const disk = new Map<string, string>()
  const api = {
    getItem: (k: string): string | null => disk.get(k) ?? null,
    setItem: (k: string, v: string): void => {
      disk.set(k, v)
    },
    removeItem: (k: string): void => {
      if (failRemovePrefix !== undefined && k.startsWith(failRemovePrefix)) return
      disk.delete(k)
    },
    clear: (): void => disk.clear(),
    key: (i: number): string | null => [...disk.keys()][i] ?? null
  }
  Object.defineProperty(api, 'length', { get: () => disk.size })
  vi.stubGlobal('localStorage', api)
  return disk
}

beforeEach(() => setAccountScope(0))
afterEach(() => {
  vi.unstubAllGlobals()
  setAccountScope(0)
})

describe('账号作用域', () => {
  it('启动时把旧全局档与云同步锚点一起搬进本账号命名空间', () => {
    const disk = installStorage()
    disk.set('yunyin.game', JSON.stringify({ lastActiveAt: 1_700_000_000_000 }))
    disk.set('yunyin.syncMeta', JSON.stringify({ baseUpdatedAt: 123 }))
    disk.set('yunyin.auth', JSON.stringify({ userId: 7, token: 't' }))
    disk.set('yunyin.settings', '{"theme":"dark"}')

    initAccountScope()

    expect(currentAccountScope()).toBe(7)
    expect(disk.get('yunyin.u7.game')).toContain('lastActiveAt')
    expect(disk.has('yunyin.game')).toBe(false)
    // 锚点错账号会让上传一直 409,必须跟着搬
    expect(disk.get('yunyin.u7.syncMeta')).toContain('baseUpdatedAt')
    expect(disk.has('yunyin.syncMeta')).toBe(false)
    // 登录态与设备级设置不搬:前者决定作用域本身,后者是设备偏好
    expect(disk.get('yunyin.auth')).toContain('userId')
    expect(disk.get('yunyin.settings')).toBe('{"theme":"dark"}')
  })

  it('键翻译只作用于进度分片与同步锚点', () => {
    setAccountScope(9)
    expect(accountStorageKey('yunyin.syncMeta')).toBe('yunyin.u9.syncMeta')
    expect(accountStorageKey('yunyin.game')).toBe('yunyin.u9.game')
    expect(accountStorageKey('yunyin.settings')).toBe('yunyin.settings')
    expect(accountStorageKey('yunyin.auth')).toBe('yunyin.auth')
    expect(accountStorageKey('yunyin.__theme')).toBe('yunyin.__theme')
  })

  it('未登录(作用域 0)时一律走设备级键', () => {
    const disk = installStorage()
    disk.set('yunyin.game', '{"lastActiveAt":1}')
    initAccountScope()
    expect(currentAccountScope()).toBe(0)
    expect(disk.get('yunyin.game')).toBe('{"lastActiveAt":1}')
    expect(accountStorageKey('yunyin.syncMeta')).toBe('yunyin.syncMeta')
  })
})

describe('清档范围', () => {
  it('removeItem 正常时顺带清掉坏档备份', () => {
    setAccountScope(7)
    const disk = installStorage()
    disk.set('yunyin.u7.game', 'mine')
    disk.set('corrupt.yunyin.u7.game', 'bad')

    clearAllSave()

    expect(disk.has('yunyin.u7.game')).toBe(false)
    expect(disk.has('corrupt.yunyin.u7.game')).toBe(false)
  })

  it('removeItem 失效时整体清空的兜底不碰其它账号', () => {
    setAccountScope(7)
    const disk = installStorage('yunyin.u7.')
    disk.set('yunyin.u7.game', 'mine')
    disk.set('yunyin.u9.game', 'other')
    disk.set('yunyin.auth', JSON.stringify({ userId: 7, token: 't' }))

    clearAllSave()

    expect(disk.has('yunyin.u7.game')).toBe(false)
    expect(disk.get('yunyin.u9.game')).toBe('other')
    expect(disk.get('yunyin.auth')).toContain('userId')
  })
})
