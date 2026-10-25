/** 弹窗层级栈:一次 Esc 只退最上面一层(模块级单栈) */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  focusTopModal,
  handleEscape,
  handOffReturnFocus,
  inLiveLayer,
  openerFor,
  pullFocusIn,
  pushModal,
  releaseReturnFocus,
  removeModal,
  resetModalStack,
  restoreFocus,
  stackedZ,
  type ModalStackEntry
} from './useModalStack'

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

  it('叠放跟栈走:后打开的压在上面,不低于自身档位底线 —— 看得见的顶层就是 Esc 关的那层', () => {
    const page = { closable: true, close: () => undefined }
    const detail = { closable: true, close: () => undefined, floor: 60 }
    const event = { closable: false, close: () => undefined }
    pushModal(page)
    pushModal(detail)
    pushModal(event)
    expect([stackedZ(page), stackedZ(detail), stackedZ(event)], '低档后开的也要压过先开的高档').toEqual([50, 60, 61])

    removeModal(detail)
    expect(stackedZ(event), '中间一层撤走,上面的随之落位').toBe(51)
    expect(stackedZ(detail), '出栈即不再占位').toBeNull()
  })

  it('某层叠回最上时:下面各层记在它面板里的还焦点目标,改指它原来的打开者 —— 它先关,面板里的目标随之卸载', () => {
    const inside = {} as HTMLElement
    const elsewhere = {} as HTMLElement
    const opener = {} as HTMLElement
    const panel = { contains: (n: unknown) => n === inside }
    const cover = { closable: true, close: () => undefined, returnFocus: inside }
    const other = { closable: true, close: () => undefined, returnFocus: elsewhere }
    pushModal(cover)
    pushModal(other)
    handOffReturnFocus(panel, opener)
    expect(cover.returnFocus, '落在叠回层面板里的目标改指原打开者').toBe(opener)
    expect(other.returnFocus, '别处的目标不动').toBe(elsewhere)
  })

  it('还焦点目标已不在页面上时,退到栈顶那层的面板', () => {
    const calls: string[] = []
    pushModal({ closable: true, close: () => undefined, focus: () => calls.push('bottom') })
    pushModal({ closable: true, close: () => undefined, focus: () => calls.push('top') })
    focusTopModal()
    expect(calls).toEqual(['top'])
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

/** 假节点:只实现还焦点判据用到的 closest / contains / isConnected / focus */
interface FakeNode {
  dialog: boolean
  parent: FakeNode | null
  isConnected: boolean
  disabled?: boolean
  closest: (sel: string) => FakeNode | null
  contains: (other: unknown) => boolean
  focus: () => void
  /** 面板才用:可 Tab 到的控件 */
  querySelectorAll?: () => FakeNode[]
  hasAttribute?: (name: string) => boolean
  offsetParent?: object | null
}

function fakeTree(log: string[]) {
  function node(name: string, parent: FakeNode | null = null, dialog = false): FakeNode {
    const n: FakeNode = {
      dialog,
      parent,
      isConnected: true,
      closest: sel => {
        expect(sel).toBe('[role="dialog"]')
        for (let c: FakeNode | null = n; c; c = c.parent) if (c.dialog) return c
        return null
      },
      contains: other => {
        for (let c = other as FakeNode | null; c; c = c.parent) if (c === n) return true
        return false
      },
      focus: () => log.push(name)
    }
    return n
  }
  const el = (n: FakeNode) => n as unknown as HTMLElement
  /** 一层弹窗:面板 + 栈条目,聚焦本层记作 `层名` */
  function layer(name: string, returnFocus: FakeNode | null) {
    const panel = node(`${name}面板`, null, true)
    const entry: ModalStackEntry = {
      closable: true,
      close: () => undefined,
      returnFocus: returnFocus ? el(returnFocus) : null,
      focus: () => log.push(name),
      panel: () => el(panel)
    }
    return { panel, entry }
  }
  /** 照 BaseModal 关闭分支:出栈 → 取打开者 → 交接;还焦点留到下一拍 */
  function close(l: { panel: FakeNode; entry: ModalStackEntry }) {
    removeModal(l.entry)
    const back = l.entry.returnFocus ?? null
    l.entry.returnFocus = null
    if (back) releaseReturnFocus(el(l.panel), back)
    return (active: FakeNode | null) => {
      if (back) restoreFocus(el(l.panel), back, active ? el(active) : null, el(BODY))
    }
  }
  const BODY = node('body')
  return { node, el, layer, close, BODY }
}

describe('弹窗关闭时的还焦点 · 不落到 body', () => {
  beforeEach(() => resetModalStack())
  afterEach(() => resetModalStack())

  it('页面上的元素与栈里那层面板里的元素在活层上;出栈(淡出中)的面板里的不算', () => {
    const t = fakeTree([])
    const onPage = t.node('页面按钮')
    const a = t.layer('甲', onPage)
    pushModal(a.entry)
    const inside = t.node('甲里的按钮', a.panel)
    expect(inLiveLayer(onPage)).toBe(true)
    expect(inLiveLayer(inside)).toBe(true)
    removeModal(a.entry)
    expect(inLiveLayer(inside), '淡出中的面板仍在文档里,但不在栈里').toBe(false)
  })

  it('被盖住的窗自己关掉(际遇超时):上层记在它面板里的还焦点目标改指它的打开者,再关上层焦点回原处', () => {
    const log: string[] = []
    const t = fakeTree(log)
    const opener = t.node('修行页按钮')
    const event = t.layer('际遇', opener)
    pushModal(event.entry)
    // 顿悟盖上来时焦点在际遇面板上
    const insight = t.layer('顿悟', event.panel)
    pushModal(insight.entry)
    const insightBtn = t.node('顿悟里的按钮', insight.panel)

    const afterEvent = t.close(event)
    expect(insight.entry.returnFocus, '改指际遇的打开者').toBe(opener)
    afterEvent(insightBtn)
    expect(log, '焦点在顿悟里,不抢').toEqual([])

    event.panel.isConnected = false
    const afterInsight = t.close(insight)
    afterInsight(insightBtn)
    expect(log).toEqual(['修行页按钮'])
  })

  it('同一拍关两层(立契确认 + 逆旅契):目标在淡出面板里不算数,落到仍开着的轮回窗 —— 两种关闭先后都一样', () => {
    for (const order of ['下层先关', '上层先关'] as const) {
      resetModalStack()
      const log: string[] = []
      const t = fakeTree(log)
      const rebirth = t.layer('轮回', t.node('首页按钮'))
      const signBtn = t.node('立契钮', rebirth.panel)
      const trial = t.layer('逆旅契', signBtn)
      const card = t.node('契卡', trial.panel)
      const pending = t.layer('立契确认', card)
      const confirm = t.node('确认立契', pending.panel)
      pushModal(rebirth.entry)
      pushModal(trial.entry)
      pushModal(pending.entry)

      const [first, second] = order === '下层先关' ? [trial, pending] : [pending, trial]
      const afterFirst = t.close(first)
      const afterSecond = t.close(second)
      // 签契后「立契」钮被印章换掉
      signBtn.isConnected = false
      afterFirst(confirm)
      afterSecond(rebirth.panel)
      expect(log, order).toEqual(['轮回'])
    }
  })

  it('关一扇开一扇(远征启程首战失利 → 战报):战报记的还焦点目标是准备窗的打开者 —— 两种先后都一样', () => {
    for (const order of ['先开后关', '先关后开'] as const) {
      resetModalStack()
      const log: string[] = []
      const t = fakeTree(log)
      const startBtn = t.node('世界卡启程钮')
      const prep = t.layer('准备', startBtn)
      const go = t.node('页脚启程', prep.panel)
      pushModal(prep.entry)

      const report = t.layer('战报', null)
      let afterPrep: (active: FakeNode | null) => void
      if (order === '先开后关') {
        report.entry.returnFocus = openerFor(t.el(go))
        pushModal(report.entry)
        afterPrep = t.close(prep)
      } else {
        afterPrep = t.close(prep)
        report.entry.returnFocus = openerFor(t.el(go))
        pushModal(report.entry)
      }
      expect(report.entry.returnFocus, order).toBe(startBtn)
      afterPrep(go)
      log.length = 0

      go.isConnected = false
      const afterReport = t.close(report)
      afterReport(t.node('战报里的按钮', report.panel))
      expect(log, order).toEqual(['世界卡启程钮'])
    }
  })
})

describe('弹窗关闭时的还焦点 · 上层还开着、目标被禁用', () => {
  beforeEach(() => resetModalStack())
  afterEach(() => resetModalStack())

  it('被盖住的窗自己关掉、焦点在 body(际遇选完):上层还开着,不还到背后页面,落到上层面板', () => {
    const log: string[] = []
    const t = fakeTree(log)
    const market = t.node('首页坊市')
    const insight = t.layer('顿悟', market)
    pushModal(insight.entry)
    const event = t.layer('际遇', t.node('顿悟里的按钮', insight.panel))
    pushModal(event.entry)

    const afterInsight = t.close(insight)
    afterInsight(t.BODY)
    expect(log, '际遇还开着,背后的坊市不该拿到焦点').toEqual(['际遇'])
    expect(event.entry.returnFocus, '际遇关掉后才还给坊市').toBe(market)
  })

  it('打开时焦点就在 body:还焦点目标是 body,关掉后落到仍开着的那层', () => {
    const log: string[] = []
    const t = fakeTree(log)
    const event = t.layer('际遇', t.node('首页坊市'))
    pushModal(event.entry)
    const insight = t.layer('顿悟', null)
    insight.entry.returnFocus = openerFor(t.el(t.BODY))
    pushModal(insight.entry)

    t.close(insight)(t.node('忽略', insight.panel))
    expect(log).toEqual(['际遇'])
  })

  it('打开者在操作后被禁用(道果 +1 余额不足):关掉说明落到熔炉面板,不留在被禁用的钮上', () => {
    const log: string[] = []
    const t = fakeTree(log)
    const furnace = t.layer('熔炉', t.node('天界按钮'))
    pushModal(furnace.entry)
    const fruitBtn = t.node('道果 +1', furnace.panel)
    const note = t.layer('道果说明', fruitBtn)
    pushModal(note.entry)

    fruitBtn.disabled = true
    t.close(note)(t.node('知道了', note.panel))
    expect(log).toEqual(['熔炉'])
  })
})

describe('焦点跑到面板外时按 Tab · 拉回栈顶面板', () => {
  beforeEach(() => resetModalStack())
  afterEach(() => resetModalStack())

  function questLog(log: string[]) {
    const t = fakeTree(log)
    const q = t.layer('修行志', t.node('修行志格'))
    const first = t.node('关闭', q.panel)
    const last = t.node('去办', q.panel)
    for (const n of [first, last]) Object.assign(n, { hasAttribute: () => false, offsetParent: {} })
    q.panel.querySelectorAll = () => [first, last]
    pushModal(q.entry)
    return { t, q, first }
  }

  it('焦点在 body(末尾的「去办」随日课达成卸掉):Tab 拉回首个控件,Shift+Tab 拉回末个', () => {
    const log: string[] = []
    const { t } = questLog(log)
    expect(pullFocusIn(t.el(t.BODY), false)).toBe(true)
    expect(pullFocusIn(t.el(t.BODY), true)).toBe(true)
    expect(log).toEqual(['关闭', '去办'])
  })

  it('焦点在面板里交给面板自己的 Tab 循环;栈空时不拦', () => {
    const log: string[] = []
    const { t, first } = questLog(log)
    expect(pullFocusIn(t.el(first), false)).toBe(false)
    resetModalStack()
    expect(pullFocusIn(t.el(t.BODY), false)).toBe(false)
    expect(log).toEqual([])
  })
})
