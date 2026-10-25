/**
 * 返回键冷启动审计:无站内来路时不得退出游戏。
 * 故障注入:把 goBack 改成裸 router.back(),第二条用例红。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Router } from 'vue-router'
import { goBack } from './goBack'

function fakeRouter(): { back: ReturnType<typeof vi.fn>; push: ReturnType<typeof vi.fn> } {
  return { back: vi.fn(), push: vi.fn() }
}

function asRouter(r: ReturnType<typeof fakeRouter>): Router {
  return r as unknown as Router
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('返回键 · 冷启动不该把人送出游戏', () => {
  it('站内有来路:照常退回去', () => {
    vi.stubGlobal('window', { history: { state: { back: '/celestial' } } })
    const r = fakeRouter()
    goBack(asRouter(r), { name: 'home' })
    expect(r.back).toHaveBeenCalledTimes(1)
    expect(r.push, '有来路时不该另开一页').not.toHaveBeenCalled()
  })

  it('没有来路(冷启动/书签/deep link):回父页,而不是退到站外', () => {
    vi.stubGlobal('window', { history: { state: null } })
    const r = fakeRouter()
    goBack(asRouter(r), { name: 'home' })
    expect(r.back, '没有站内上一页时 back() 会退到 about:blank').not.toHaveBeenCalled()
    expect(r.push).toHaveBeenCalledWith({ name: 'home' })
  })

  it('back 字段为空串同样算没有来路', () => {
    vi.stubGlobal('window', { history: { state: { back: '' } } })
    const r = fakeRouter()
    goBack(asRouter(r), { name: 'celestial' })
    expect(r.back).not.toHaveBeenCalled()
    expect(r.push).toHaveBeenCalledWith({ name: 'celestial' })
  })
})
