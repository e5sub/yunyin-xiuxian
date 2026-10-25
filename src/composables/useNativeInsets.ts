/**
 * 原生系统栏占位,单位:CSS px。
 * 安卓边到边下 WebView 的 env(safe-area-inset-bottom) 恒为 0,占位由原生量好经 window.NativeApp 桥暴露(MainActivity.java)。
 * 底部取 tappableElement(手势导航为 0),顶部是状态栏高度;非安卓无此桥,一律 0。
 */
import { onMounted, onUnmounted, ref, type Ref } from 'vue'

interface NativeAppBridge {
  insetTop?: () => number
  insetBottom?: () => number
}

/** 桥或方法缺失、抛错、非有限数、负数一律当 0 */
function safeInset(read: (() => number) | undefined): number {
  if (typeof read !== 'function') return 0
  try {
    const v = read()
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0
  } catch {
    return 0
  }
}

export function readNativeInsets(bridge?: NativeAppBridge): { top: number; bottom: number } {
  const b = bridge ?? (globalThis as { NativeApp?: NativeAppBridge }).NativeApp
  return { top: safeInset(b?.insetTop), bottom: safeInset(b?.insetBottom) }
}

/**
 * 挂载时读一次;原生在 insets 变化(旋转、切换导航模式)时派发 nativeinsets 再读。
 * 首次派发早于页面加载,丢失无妨:挂载那次读的是原生缓存的最新值。
 */
export function useNativeInsets(): { top: Ref<number>; bottom: Ref<number> } {
  const top = ref(0)
  const bottom = ref(0)
  const refresh = (): void => {
    const r = readNativeInsets()
    top.value = r.top
    bottom.value = r.bottom
  }
  onMounted(() => {
    refresh()
    window.addEventListener('nativeinsets', refresh)
  })
  onUnmounted(() => window.removeEventListener('nativeinsets', refresh))
  return { top, bottom }
}
