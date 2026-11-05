import { createApp } from 'vue'
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import { Capacitor } from '@capacitor/core'
import App from './App.vue'
import { router } from './router'
import { initAccountScope, migrateLocalSchema, preflightScan } from './utils/storage'
import { sanitizeAllStores } from './stores/sanitizeAll'
import { useUiStore } from './stores/ui'
import { summarizeError, useDiagStore } from './stores/diag'
import { useServiceWorkerUpdate } from './composables/useServiceWorkerUpdate'
import './style.css'

// 先按登录账号定存储命名空间(含旧全局档的一次性迁移),再扫描损坏存档:
// 两步都必须早于任何 store 水合,否则读错账号的档
initAccountScope()
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
    useUiStore().toast('异常已留档', 'warn')
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
  useUiStore().toast('存档损坏,已隔离修复', 'warn')
}

// SW 只在生产构建的网页部署上注册。dev 下会缓存 HMR 产物;
// Electron(file://)/ Capacitor(https://localhost)里 SW 接管导航后本地 fetch 失败,第二次启动起 Windows 版白屏、安卓版卡加载遮罩(首次正常)。
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
