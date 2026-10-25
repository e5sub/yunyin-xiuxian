/** 弹窗层级栈,全站唯一:一次 Esc 只退栈顶一层;叠放次序也跟它走 */
import { onUnmounted, ref } from 'vue'

export interface ModalStackEntry {
  closable: boolean
  close: () => void
  /** 叠放底线(z-index),缺省 50 */
  floor?: number
  /** 关闭后焦点还给谁 */
  returnFocus?: HTMLElement | null
  /** 聚焦本层面板 */
  focus?: () => void
  /** 本层面板:判焦点在活层还是在淡出的面板里 */
  panel?: () => HTMLElement | null
}

/** 模块级单栈,所有 BaseModal 实例共享;放进组件作用域会让一次 Esc 关掉两层 */
const stack: ModalStackEntry[] = []
/** 栈每变一次加一,供 stackedZ 的调用方重算 */
const revision = ref(0)
const DEFAULT_FLOOR = 50
let listening = false

function onWindowKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    if (handleEscape()) e.preventDefault()
    return
  }
  if (e.key === 'Tab' && pullFocusIn(document.activeElement, e.shiftKey)) e.preventDefault()
}

function ensureListener(): void {
  if (listening || typeof window === 'undefined') return
  window.addEventListener('keydown', onWindowKeydown)
  listening = true
}

function releaseListenerIfIdle(): void {
  if (!listening || stack.length > 0 || typeof window === 'undefined') return
  window.removeEventListener('keydown', onWindowKeydown)
  listening = false
}

/** 处理一次 Esc:只关栈顶;栈顶不可关时吞掉,不越层。返回 true = 已被弹窗消费 */
export function handleEscape(): boolean {
  const top = stack[stack.length - 1]
  if (!top) return false
  if (top.closable) top.close()
  return true
}

/** 压入一层;同一 entry 重复压入不会产生两份 */
export function pushModal(entry: ModalStackEntry): void {
  const i = stack.indexOf(entry)
  if (i >= 0) stack.splice(i, 1)
  stack.push(entry)
  revision.value += 1
  ensureListener()
}

/** 焦点移到栈顶那层的面板:还焦点目标已不在页面上时兜底,免得落到背后的页面 */
export function focusTopModal(): void {
  stack[stack.length - 1]?.focus?.()
}

/** 可 Tab 到的控件:面板内首尾循环与焦点拉回共用 */
export function focusablesIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(
    el => !el.hasAttribute('disabled') && el.offsetParent !== null
  )
}

/**
 * 焦点不在栈顶面板里时按 Tab(面板里聚焦的元素被 v-if 卸掉,焦点落到 body):拉回面板首个 / 末个控件。
 * 焦点在面板里时交给面板自己的 keydown。返回 true = 已拉回
 */
export function pullFocusIn(active: Element | null, backwards: boolean): boolean {
  const panel = stack[stack.length - 1]?.panel?.()
  if (!panel || (active && panel.contains(active))) return false
  const items = focusablesIn(panel)
  ;((backwards ? items[items.length - 1] : items[0]) ?? panel).focus()
  return true
}

/**
 * 某层叠回最上时调用:下面各层记的还焦点目标若在它面板里,改指它原来的打开者。
 * 它会先关,面板里的目标随之卸载。
 */
export function handOffReturnFocus(panel: Pick<HTMLElement, 'contains'>, opener: HTMLElement | null): void {
  for (const e of stack) {
    if (e.returnFocus && panel.contains(e.returnFocus)) e.returnFocus = opener
  }
}

/** 刚关的面板 → 它的打开者:同一拍新开的窗记还焦点目标时查 */
const leavingOpeners = new WeakMap<object, HTMLElement>()

/** 在活层上:不在任何弹窗里(页面本身),或在栈里某层的面板里;淡出中的面板不算 */
export function inLiveLayer(el: Pick<Element, 'closest'>): boolean {
  const dialog = el.closest('[role="dialog"]')
  return dialog === null || stack.some(e => e.panel?.() === dialog)
}

/**
 * 某层关闭(已出栈)时调用:栈里记在它面板里(含面板本身)的还焦点目标改指它的打开者。
 * 被盖住的窗自己关掉(际遇超时)、同一拍关两层、关一扇开一扇都走这里。
 */
export function releaseReturnFocus(panel: HTMLElement, opener: HTMLElement): void {
  handOffReturnFocus(panel, opener)
  leavingOpeners.set(panel, opener)
}

/** 打开时记还焦点目标:焦点还停在刚关的面板里,记那扇窗的打开者 */
export function openerFor(active: Element | null): HTMLElement | null {
  if (!active) return null
  const dialog = active.closest('[role="dialog"]')
  const opener = dialog && !inLiveLayer(active) ? leavingOpeners.get(dialog) : undefined
  return opener ?? (active as HTMLElement)
}

/**
 * 还焦点目标可用:还在页面上、没被禁用;
 * 栈里还有弹窗时须在最上那层面板里(背后的页面、淡出的面板都不算),栈空时不在淡出的面板里。
 */
function canRestoreTo(el: HTMLElement): boolean {
  if (!el.isConnected || (el as HTMLButtonElement).disabled === true) return false
  const top = stack[stack.length - 1]
  return top ? top.panel?.()?.contains(el) === true : el.closest('[role="dialog"]') === null
}

/** 关闭后还焦点:焦点已被活层接走不抢;目标不可用(已卸载、被禁用、被上层盖住、在淡出面板里)时退到栈顶那层 */
export function restoreFocus(panel: Pick<Element, 'contains'> | null, back: HTMLElement, active: Element | null, body: HTMLElement): void {
  const taken = active !== null && active !== body && !panel?.contains(active) && inLiveLayer(active)
  if (taken) return
  if (canRestoreTo(back)) back.focus()
  else focusTopModal()
}

/** 是否栈顶 */
export function isTopModal(entry: ModalStackEntry): boolean {
  return stack[stack.length - 1] === entry
}

/** 按身份摘除;关闭与卸载都可能调用,重复调用无害 */
export function removeModal(entry: ModalStackEntry): void {
  const i = stack.indexOf(entry)
  if (i >= 0) {
    stack.splice(i, 1)
    revision.value += 1
  }
  releaseListenerIfIdle()
}

/** 清空整栈(应用卸载、开发态热更新、测试隔离用) */
export function resetModalStack(): void {
  stack.splice(0, stack.length)
  revision.value += 1
  releaseListenerIfIdle()
}

/**
 * 叠放次序:后入栈的压在先入栈的上面,且不低于自身底线。
 * 按挂载先后、按档位叠放时,后弹出的际遇、顿悟会被页内弹窗或 top 弹窗盖住,Esc 却落在被盖的那扇。
 * 不在栈里返回 null;在 computed 里读可随栈变动重算。
 */
export function stackedZ(entry: ModalStackEntry): number | null {
  void revision.value
  let z = 0
  for (const e of stack) {
    z = Math.max(e.floor ?? DEFAULT_FLOOR, z + 1)
    if (e === entry) return z
  }
  return null
}

/** 组件卸载时自动摘除这一层 */
export function useModalEntry(entry: ModalStackEntry): void {
  onUnmounted(() => removeModal(entry))
}
