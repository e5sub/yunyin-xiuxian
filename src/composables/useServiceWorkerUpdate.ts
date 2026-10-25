/**
 * Service Worker 新版本检测:旧版在跑、新版本就绪时调 onUpdate,弹不弹「重载」由调用方定。
 * sw.js 已有 skipWaiting + clientsClaim(见其「发版提醒」注释)。
 */

export interface ServiceWorkerUpdateHandle {
  /** 向等待中的 SW 补一次通知后 `location.reload()` */
  reload(): void
  /** 停止监听,不再触发 onUpdate */
  stop(): void
}

export function useServiceWorkerUpdate(
  registration: ServiceWorkerRegistration,
  onUpdate?: () => void
): ServiceWorkerUpdateHandle {
  let stopped = false
  let installing: ServiceWorker | null = null

  const handleInstallerState = (): void => {
    if (!installing || installing.state !== 'installed') return
    if (stopped) return
    // controller 为空 = 首次安装,页面已是最新版,不提示
    if (navigator.serviceWorker.controller) onUpdate?.()
  }

  const handleUpdateFound = (): void => {
    if (stopped) return
    const next = registration.installing
    if (!next) return
    installing?.removeEventListener('statechange', handleInstallerState)
    installing = next
    installing.addEventListener('statechange', handleInstallerState)
  }

  registration.addEventListener('updatefound', handleUpdateFound)

  // 注册完成后主动检测一次,防更新恰在注册那一下被漏掉
  void registration.update().catch(() => {
    /* 失败忽略:下次导航仍会查 */
  })

  return {
    reload() {
      // sw.js 在 install 已 skipWaiting,此处兜底;无监听方则消息被忽略
      const waiting = registration.waiting ?? registration.installing ?? null
      try {
        waiting?.postMessage({ type: 'SKIP_WAITING' })
      } catch {
        /* 通知失败照常重载 */
      }
      location.reload()
    },
    stop() {
      if (stopped) return
      stopped = true
      registration.removeEventListener('updatefound', handleUpdateFound)
      installing?.removeEventListener('statechange', handleInstallerState)
      installing = null
    }
  }
}
