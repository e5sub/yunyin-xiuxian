/**
 * 弹窗层级栈 —— 全站唯一的一份。
 *
 * BaseModal 的 `<script setup>` 每个实例各跑一次。若把「已打开弹窗」的数组
 * 写在组件作用域里,每扇窗都以为自己才是栈底:两层同时打开时,一次 Esc 会
 * 依次命中两份独立的 keydown 监听,把「详情盖列表」的两层一起关掉。
 *
 * 故栈必须挂在模块级:打开时压入、关闭/卸载时按身份摘除,只让最上面那层
 * 响应 Esc。closable=false 的顶层照样压栈 —— 它挡在那里时,Esc 不该越层去关
 * 底下的窗。
 */
import { onUnmounted } from 'vue'

export interface ModalStackEntry {
  closable: boolean
  close: () => void
}

/** 模块级单栈:同一页里的所有 BaseModal 实例共享 */
const stack: ModalStackEntry[] = []
let listening = false

function onWindowKeydown(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return
  if (!handleEscape()) return
  e.preventDefault()
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
  ensureListener()
}

/** 按身份摘除;关闭与卸载都可能调用,重复调用无害 */
export function removeModal(entry: ModalStackEntry): void {
  const i = stack.indexOf(entry)
  if (i >= 0) stack.splice(i, 1)
  releaseListenerIfIdle()
}

/** 应用卸载时清空整栈,避免开发态热更新或测试隔离残留 */
export function resetModalStack(): void {
  stack.splice(0, stack.length)
  releaseListenerIfIdle()
}

/** 把一层弹窗登记进全站栈,并在组件卸载时自动摘除 */
export function useModalEntry(entry: ModalStackEntry): void {
  onUnmounted(() => removeModal(entry))
}
