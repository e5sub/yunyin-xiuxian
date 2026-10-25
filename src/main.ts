import { createApp } from 'vue'
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import { Capacitor } from '@capacitor/core'
import App from './App.vue'
import { router } from './router'
import { migrateLocalSchema, preflightScan } from './utils/storage'
import { sanitizeAllStores } from './stores/sanitizeAll'
import { useUiStore } from './stores/ui'
import { summarizeError, useDiagStore } from './stores/diag'
import { useServiceWorkerUpdate } from './composables/useServiceWorkerUpdate'
import './style.css'

// 启动前扫描损坏存档 + 结构升级,避免白屏
const corrupted = preflightScan()
migrateLocalSchema()

const app = createApp(App)
const pinia = createPinia()
pinia.use(piniaPluginPersistedstate)

app.use(pinia)
app.use(router)

function noteError(info: string, err: unknown): void {
  try {
    useDiagStore().record({ info, message: summarizeError(err), route: location.hash })
  } catch {
    /* 留档自身不许再抛 */
  }
}

app.config.errorHandler = (err, _instance, info) => {
  console.error('[全局异常]', info, err)
  noteError(String(info), err)
  try {
    useUiStore().toast('出现异常,已记入留档(设置页可查)', 'warn')
  } catch {
    // UI 尚未就绪时静默
  }
}

window.addEventListener('unhandledrejection', event => {
  console.error('[未处理的 Promise]', event.reason)
  noteError('unhandledrejection', event.reason)
})

// 须在首次渲染前逐仓自愈 hydrate 进来的坏值;幂等,engine.start 在 onMounted 再调一遍
sanitizeAllStores()

app.mount('#app')

if (corrupted.length > 0) {
  useUiStore().corruptedNotice = corrupted
  useUiStore().toast('检测到部分存档数据异常,已为你隔离修复', 'warn')
}

// PWA 离线缓存:只在生产构建、且只在**真正的网页部署**上注册。
// dev 下 SW 会缓存 HMR 产物、干扰热重载;而 Electron(file://)与 Capacitor(https://localhost)
// 本身就是本地文件,离线缓存毫无意义,反而致命:SW 接管导航后 fetch() 这类本地 URL 会失败,
// 缓存又没有副本,于是第二次启动起就只剩「离线且无缓存副本」—— Windows 版白屏、
// 安卓版卡在加载遮罩(玩家反馈)。第一次启动总是好的,因为那次 SW 还没接管,最会误导排查。
// 注册失败静默 —— 有 SW 是增强(断网可重开),没有也不影响在线游玩。
const isLocalShell = location.protocol === 'file:' || Capacitor.isNativePlatform()
if (import.meta.env.PROD && !isLocalShell && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .then(reg => {
        const handle = useServiceWorkerUpdate(reg, () => useUiStore().requestPwaUpdate())
        useUiStore().setPwaApplyReload(() => handle.reload())
      })
      .catch(() => {
        /* 注册失败静默:可降级,见 public/sw.js */
      })
  })
}
