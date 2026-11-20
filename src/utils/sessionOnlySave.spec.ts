/**
 * 纯网游存储分层(1.76.0):进度分片只写会话缓存(sessionStorage),不落磁盘。
 *
 * 两块盘语义不同:
 * · 会话缓存 = 本局内存态的镜像,关页即清 —— 本机不再保存任何游戏进度;
 * · localStorage 只留设备级的东西(auth / settings / diag / syncMeta / 心跳)。
 *
 * 须同测的不变量:
 * 1. 进度分片与会话缓存一块盘,settings/diag 与 localStorage 一块盘,互不越界;
 * 2. 清档连 localStorage 里的旧版残留一起清(升级用户);
 * 3. 换号后上一账号的会话分片键被 initAccountScope 清掉(与 localStorage 账号隔离同一套判据);
 * 4. 导出/上传读的是会话缓存里的最新态 —— 权威在服务端,会话层只是缓存,但缓存必须可导出。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildExportPayload,
  clearAllSave,
  currentAccountScope,
  dropPendingWrites,
  flushSaveWrites,
  initAccountScope,
  isSessionSlice,
  PERSISTED_STORES,
  persistConfig,
  setAccountScope,
  storageKey
} from './storage'

/** 两块独立假盘:ls = localStorage,ss = sessionStorage */
function installDisks(): { ls: Map<string, string>; ss: Map<string, string> } {
  const ls = new Map<string, string>()
  const ss = new Map<string, string>()
  const make = (disk: Map<string, string>) => ({
    getItem: (k: string): string | null => disk.get(k) ?? null,
    setItem: (k: string, v: string): void => {
      disk.set(k, v)
    },
    removeItem: (k: string): void => {
      disk.delete(k)
    },
    clear: (): void => disk.clear(),
    key: (i: number): string | null => [...disk.keys()][i] ?? null,
    get length(): number {
      return disk.size
    }
  })
  vi.stubGlobal('localStorage', make(ls))
  vi.stubGlobal('sessionStorage', make(ss))
  return { ls, ss }
}

let disks: { ls: Map<string, string>; ss: Map<string, string> }

beforeEach(() => {
  dropPendingWrites()
  disks = installDisks()
  setAccountScope(0)
})

afterEach(() => {
  dropPendingWrites()
  vi.unstubAllGlobals()
  setAccountScope(0)
})

describe('纯网游存储分层', () => {
  it('进度分片走会话缓存:写进 sessionStorage,localStorage 里一个字都没有', () => {
    const { storage, serializer, key } = persistConfig('player')
    storage.setItem(key, serializer.serialize({ exp: 42, name: '云隐' }))
    flushSaveWrites()
    expect(disks.ss.get(key)).toBeDefined()
    expect(disks.ls.get(key)).toBeUndefined()
  })

  it('settings / diag 是设备级分片:仍落 localStorage,不进会话缓存', () => {
    for (const id of ['settings', 'diag']) {
      const { storage, serializer, key } = persistConfig(id)
      storage.setItem(key, serializer.serialize({ n: 1 }))
    }
    flushSaveWrites()
    expect(disks.ls.size).toBeGreaterThanOrEqual(2)
    expect(disks.ss.size).toBe(0)
  })

  it('分层清单自洽:除 settings/diag 外全部进度分片都判为会话分片', () => {
    const sessionIds = PERSISTED_STORES.filter(isSessionSlice)
    expect(sessionIds).toContain('player')
    expect(sessionIds).toContain('resources')
    expect(sessionIds).toContain('game')
    expect(isSessionSlice('settings')).toBe(false)
    expect(isSessionSlice('diag')).toBe(false)
    expect(PERSISTED_STORES.filter(id => !isSessionSlice(id))).toEqual(['settings', 'diag'])
  })

  it('清档连 localStorage 里的旧版进度残留一起清(升级用户)', () => {
    // 旧版本把进度写在 localStorage;新层不再读它,但清档必须把它带走
    disks.ls.set(storageKey('inventory'), '旧版残留')
    disks.ss.set(storageKey('resources'), '会话缓存')
    clearAllSave()
    expect(disks.ls.get(storageKey('inventory'))).toBeUndefined()
    expect(disks.ss.get(storageKey('resources'))).toBeUndefined()
  })

  it('换号后上一账号的会话分片键被 initAccountScope 清掉,本账号的保留', () => {
    // 登录态指向账号 5
    disks.ls.set('yunyin.auth', JSON.stringify({ userId: 5 }))
    disks.ss.set('yunyin.u7.player', '别人的进度')
    disks.ss.set('yunyin.u5.resources', '我的进度')
    disks.ss.set('yunyin.__theme', 'dark') // 非分片键:不碰
    initAccountScope()
    expect(currentAccountScope()).toBe(5)
    expect(disks.ss.has('yunyin.u7.player')).toBe(false)
    expect(disks.ss.has('yunyin.u5.resources')).toBe(true)
    expect(disks.ss.get('yunyin.__theme')).toBe('dark')
  })

  it('未登录启动时清掉全部会话分片键(会话盘里不留无主进度)', () => {
    disks.ss.set('yunyin.u3.player', '无主进度')
    initAccountScope()
    expect(disks.ss.has('yunyin.u3.player')).toBe(false)
  })

  it('导出/上传读的是会话缓存里的最新态', () => {
    setAccountScope(5)
    disks.ls.set('yunyin.auth', JSON.stringify({ userId: 5 }))
    const { storage, serializer, key } = persistConfig('player')
    storage.setItem(key, serializer.serialize({ exp: 99 }))
    flushSaveWrites()
    expect(buildExportPayload().data.player).toEqual({ exp: 99 })
  })
})
