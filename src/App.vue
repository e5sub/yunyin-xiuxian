<template>
  <!-- 桌面端外框:居中手机区域 -->
  <div
    class="app-shell mx-auto flex max-w-107.5 flex-col overflow-hidden bg-paper shadow-[0_0_60px_rgba(0,0,0,0.45)] relative paper-grain"
  >
    <TopStatusBar v-if="game.started && route.name !== 'create'" />

    <main ref="scrollHost" class="relative z-10 min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
      <RouterView v-slot="{ Component }">
        <Transition name="page-fade" mode="out-in" @before-enter="resetScroll">
          <component :is="Component" />
        </Transition>
      </RouterView>
    </main>

    <BottomNavigation v-if="game.started && route.name !== 'create'" />

    <!-- 全局浮层 -->
    <ToastHost />
    <UpdatePrompt />
    <OfflineRewardDialog />
    <BreakthroughResultDialog />
    <EventDialog v-if="game.started" />
    <ReincarnationDialog />
    <EquipmentDetailDialog />
    <ExitConfirmDialog />
    <!-- 修炼中偶发事件浮层:须挂全局,否则漏掉窗口期 -->
    <EnlightenmentModal v-if="game.started" />
    <CaveEventModal v-if="game.started" />
  </div>
</template>

<script setup lang="ts">
  import { onMounted, onUnmounted, ref, watch } from 'vue'
  import { useRoute, useRouter } from 'vue-router'
  import { useGameStore } from '@/stores/game'
  import { useUiStore } from '@/stores/ui'
  import { useSettingsStore } from '@/stores/settings'
  import { useAuthStore } from '@/stores/auth'
  import { subscribeSaveWriteFailure } from '@/utils/storage'
  import { engine } from '@/core/engine'
  import { startAutoOps, stopAutoOps } from '@/core/autoOps'
  import { connectCloudWs, disconnectCloudWs, onSessionEnd } from '@/services/cloud'
  import { probeCloudNewer, pushCloudSave, restoreFromCloud, startCloudSync, stopCloudSync, syncNotice } from '@/core/cloudSave'
  import { applyTheme, initTheme } from '@/core/theme'
  import { resetModalStack } from '@/composables/useModalStack'
  import { configureAudio, disposeAudio, playSfx, unlockAudio } from '@/core/audio'
  import TopStatusBar from '@/components/common/TopStatusBar.vue'
  import BottomNavigation from '@/components/common/BottomNavigation.vue'
  import ToastHost from '@/components/common/ToastHost.vue'
  import UpdatePrompt from '@/components/common/UpdatePrompt.vue'
  import OfflineRewardDialog from '@/components/offline/OfflineRewardDialog.vue'
  import BreakthroughResultDialog from '@/components/cultivation/BreakthroughResultDialog.vue'
  import EventDialog from '@/components/adventure/EventDialog.vue'
  import ReincarnationDialog from '@/components/character/ReincarnationDialog.vue'
  import EquipmentDetailDialog from '@/components/equipment/EquipmentDetailDialog.vue'
  import ExitConfirmDialog from '@/components/common/ExitConfirmDialog.vue'
  import EnlightenmentModal from '@/components/cultivation/EnlightenmentModal.vue'
  import CaveEventModal from '@/components/dongfu/CaveEventModal.vue'

  const game = useGameStore()
  const ui = useUiStore()
  const settings = useSettingsStore()
  const route = useRoute()
  const router = useRouter()

  /** 内容区滚动宿主:滚动条在常驻的 main 上,不在 window */
  const scrollHost = ref<HTMLElement | null>(null)

  /**
   * 切页归零滚动:main 常驻,scrollTop 会被下一页继承;router 的 scrollBehavior 只管 window,不顶用。
   * 挂 before-enter 而非 watch(route):out-in 下此刻旧页已离场,不会跳回顶部。
   */
  function resetScroll(): void {
    if (scrollHost.value) scrollHost.value.scrollTop = 0
  }

  let unsubscribeTheme: () => void = () => undefined
  let unsubscribeSaveFailure: () => void = () => undefined

  /** 网游会话:已登录则连 ws + 拉云端档 + 启动定时推送 */
  async function bootstrapCloud(): Promise<void> {
    const auth = useAuthStore()
    if (!auth.loggedIn) return
    connectCloudWs()
    // VIP 状态随会话刷新(GM 发放/续期后,玩家刷新页面即生效)
    void auth.refreshVip().catch(() => undefined)
    const restored = await restoreFromCloud()
    if (restored) return // 云端档已应用并重载
    // 本机已对齐过但云端更新:不擅自覆盖(本机可能有未上传的进度),提示玩家自行决定
    const newerAt = await probeCloudNewer()
    if (newerAt !== null) ui.toast('云端存档比本机新,可在「设置 → 存档」中恢复', 'warn')
    startCloudSync()
  }

  /** 首次交互后才能出声(浏览器策略);按钮附带点击音 */
  function onPointerDown(e: PointerEvent): void {
    unlockAudio()
    if ((e.target as HTMLElement | null)?.closest('button')) playSfx('click')
  }

  // 音量 0~100 → 0~1
  watch(
    () => [settings.musicOn, settings.sfxOn, settings.musicVol, settings.sfxVol] as const,
    ([musicOn, sfxOn, musicVol, sfxVol]) => {
      configureAudio({ musicOn, sfxOn, musicVol: musicVol / 100, sfxVol: sfxVol / 100 })
    },
    { immediate: true }
  )

  // 云同步异常提示:core 只抛状态,弹窗归界面层
  watch(syncNotice, notice => {
    if (notice !== null) ui.toast(notice.text, 'warn')
  })

  // 会话失效统一出口:kicked=被新设备挤下线(宽限期内最后一推存档),expired=token 彻底失效(密钥变更/改密/过期)
  onSessionEnd(async reason => {
    if (reason === 'kicked') {
      try {
        await pushCloudSave()
      } catch {
        // 尽力而为:推不上也不拦登出
      }
    }
    stopCloudSync()
    disconnectCloudWs()
    useAuthStore().logout()
    ui.toast(reason === 'kicked' ? '账号已在其他设备登录,本机已下线' : '登录已失效,请重新登录', 'warn')
    void router.push('/login')
  })

  // 开局(含转世重开)后立刻推一次:不等 20 秒定时器,玩家可能开局就退
  watch(
    () => game.started,
    started => {
      if (started) void pushCloudSave()
    }
  )

  // 主题;auto 时随系统切换
  watch(
    () => settings.theme,
    t => applyTheme(t),
    { immediate: true }
  )

  // 减少动效类挂 body 而非 .app-shell:Teleport 到 body 的弹层在 .app-shell 之外,吃不到后代选择器
  watch(
    () => settings.reduceMotion,
    v => document.body.classList.toggle('reduce-motion', v),
    { immediate: true }
  )

  onMounted(() => {
    unsubscribeTheme = initTheme(() => settings.theme)
    // 存档写入失败 / 恢复各报一次:订阅只在状态翻转时回调
    unsubscribeSaveFailure = subscribeSaveWriteFailure(failure => {
      if (failure) ui.toast('存档写入失败', 'warn')
      else ui.toast('存档已恢复写入', 'info')
    })
    engine.start()
    startAutoOps()
    void bootstrapCloud()
    window.addEventListener('pointerdown', onPointerDown)
  })

  onUnmounted(() => {
    unsubscribeTheme()
    unsubscribeSaveFailure()
    engine.stop()
    stopAutoOps()
    disconnectCloudWs()
    resetModalStack()
    disposeAudio()
    window.removeEventListener('pointerdown', onPointerDown)
  })
</script>
