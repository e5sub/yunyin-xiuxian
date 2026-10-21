/**
 * 弹窗层级栈 —— 一次 Esc 只退最上面一层。
 *
 * 由来:BaseModal 的 `<script setup>` 每个实例各跑一次,旧实现把 activeModals
 * 写在该作用域里,于是「详情盖列表」两层同时打开时,一次 Esc 会命中两份独立
 * 的 window keydown,把两层一起关掉。这里直接钉住模块级单栈的行为。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleEscape, pushModal, removeModal, resetModalStack } from './useModalStack'

describe('弹窗层级栈 · 一次 Esc 只退一层', () => {
  beforeEach(() => resetModalStack())
  afterEach(() => resetModalStack())

  it('两层弹窗同时打开时,只关最上面那层', () => {
    const bottom = vi.fn()
    const top = vi.fn()
    pushModal({ closable: true, close: bottom })
    pushModal({ closable: true, close: top })

    expect(handleEscape()).toBe(true)
    expect(top).toHaveBeenCalledTimes(1)
    expect(bottom, '底层弹窗不该被同一次 Esc 带走').not.toHaveBeenCalled()

    removeModal({ closable: true, close: bottom })
    removeModal({ closable: true, close: top })
  })

  it('栈顶不可关时吞掉 Esc,不越层关底下的窗', () => {
    const bottom = vi.fn()
    const top = vi.fn()
    pushModal({ closable: true, close: bottom })
    pushModal({ closable: false, close: top })

    expect(handleEscape()).toBe(true)
    expect(top).not.toHaveBeenCalled()
    expect(bottom, '不可关的顶层应挡住 Esc').not.toHaveBeenCalled()

    removeModal({ closable: true, close: bottom })
    removeModal({ closable: false, close: top })
  })

  it('栈空时 Esc 不被弹窗消费', () => {
    expect(handleEscape()).toBe(false)
  })

  it('每层只挂一份 Esc 监听:两个实例不会把同一次按键处理两遍', () => {
    const calls: string[] = []
    const listeners = new Map<string, (e: KeyboardEvent) => void>()
    resetModalStack()
    vi.stubGlobal('window', {
      addEventListener: (type: string, cb: EventListener) => {
        listeners.set(type, cb as (e: KeyboardEvent) => void)
      },
      removeEventListener: (type: string) => {
        listeners.delete(type)
      }
    })

    pushModal({ closable: true, close: () => calls.push('bottom') })
    pushModal({ closable: true, close: () => calls.push('top') })

    expect(listeners.size, '无论几层弹窗,window 上只该有一份 keydown').toBe(1)
    listeners.get('keydown')!({ key: 'Escape', preventDefault: () => undefined } as KeyboardEvent)
    expect(calls, '一次 Esc 只该退一层').toEqual(['top'])
    vi.unstubAllGlobals()
  })
})
