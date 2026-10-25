import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { applyTheme, initTheme } from './theme'

/** 最小 document stub(theme.ts 用 documentElement.dataset + meta[name=theme-color]) */
const docEl = {
  _theme: '',
  dataset: {} as Record<string, string>,
  setAttribute(k: string, v: string) {
    this._theme = v
    this.dataset[k] = v
  },
  removeAttribute(k: string) {
    delete this.dataset[k]
  }
}

const metaEl = { name: '', content: '' }
const docStub = {
  documentElement: docEl,
  querySelector: () => metaEl,
  createElement: () => metaEl,
  head: { appendChild: () => {} }
}

type Listener = () => void

/** 模拟 matchMedia;set() 触发系统切换 */
const mockMatchMedia = (initialDark: boolean) => {
  let dark = initialDark
  const listeners: Listener[] = []
  vi.stubGlobal('matchMedia', (query: string) => {
    const isDark = query.includes('dark')
    return {
      get matches() {
        return isDark ? dark : !dark
      },
      media: query,
      addEventListener: (_: string, cb: Listener) => listeners.push(cb),
      removeEventListener: (_: string, cb: Listener) => {
        const i = listeners.indexOf(cb)
        if (i >= 0) listeners.splice(i, 1)
      }
    }
  })
  return {
    set: (d: boolean) => {
      dark = d
      listeners.forEach(cb => cb())
    }
  }
}

describe('theme', () => {
  beforeEach(() => {
    vi.stubGlobal('document', docStub)
    docEl.removeAttribute('data-theme')
    metaEl.content = ''
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('显式夜间设置 data-theme=dark,日间设置 light', () => {
    applyTheme('dark')
    expect(docEl.dataset.theme).toBe('dark')
    applyTheme('light')
    expect(docEl.dataset.theme).toBe('light')
  })

  it('theme-color 随主题切换在亮暗两色间同步', () => {
    applyTheme('dark')
    expect(metaEl.content).toBe('#211F1C')
    applyTheme('light')
    expect(metaEl.content).toBe('#F3EFE4')
  })

  it('auto 跟随系统深浅', () => {
    const mq = mockMatchMedia(true)
    applyTheme('auto')
    expect(docEl.dataset.theme).toBe('dark')
    mq.set(false)
    applyTheme('auto')
    expect(docEl.dataset.theme).toBe('light')
  })

  it('initTheme 注册系统切换监听:auto 下系统切换实时跟随,显式模式不跟随', () => {
    const mq = mockMatchMedia(true)
    let mode = 'auto' as 'auto' | 'light' | 'dark'
    const dispose = initTheme(() => mode)
    expect(docEl.dataset.theme).toBe('dark')

    // 系统切日间
    mq.set(false)
    expect(docEl.dataset.theme).toBe('light')

    // 显式夜间:系统再切不改主题
    mode = 'dark'
    applyTheme('dark')
    mq.set(true)
    expect(docEl.dataset.theme).toBe('dark')

    // 回到 auto:跟随系统(日间)
    mode = 'auto'
    mq.set(false)
    expect(docEl.dataset.theme).toBe('light')

    dispose()
  })

  it('无 matchMedia 环境不抛错', () => {
    vi.stubGlobal('matchMedia', undefined)
    expect(() => applyTheme('auto')).not.toThrow()
    expect(() => initTheme(() => 'auto')).not.toThrow()
  })
})
