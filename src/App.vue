<template>
  <!-- 桌面端外框:居中手机区域 -->
  <div
    class="app-shell mx-auto flex max-w-107.5 flex-col overflow-hidden bg-paper shadow-[0_0_60px_rgba(0,0,0,0.45)] relative paper-grain"
  >
    <TopStatusBar v-if="auth.loggedIn && game.started && route.name !== 'create'" />

    <main ref="scrollHost" tabindex="-1" class="relative z-10 min-h-0 flex-1 overflow-y-auto overflow-x-hidden outline-none">
      <RouterView v-slot="{ Component }">
        <Transition name="page-fade" mode="out-in" @before-enter="resetScroll" @after-enter="focusContent">
          <component :is="Component" />
        </Transition>
      </RouterView>
    </main>

    <BottomNavigation v-if="auth.loggedIn && game.started && route.name !== 'create'" />

    <!-- 全局浮层 -->
    <ToastHost />
    <!-- 得宝仪典:顶档之物入手的「那一瞬」,层级高于 toast(见 ui/treasureCeremony) -->
    <TreasureCeremony />
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
  import { subscribeOtherTabSave, subscribeSaveWriteFailure, watchOtherTabSave } from '@/utils/storage'
  import { engine } from '@/core/engine'
  import { startAutoOps, stopAutoOps, prepOfflineAutoOps, collectOfflineBossLedger } from '@/core/autoOps'
  import { connectCloudWs, disconnectCloudWs, onSessionEnd } from '@/services/cloud'
  import { autoRestoreIfNewer, probeCloudNewer, pushCloudSave, restoreFromCloud, startCloudSync, stopCloudSync, syncNotice } from '@/core/cloudSave'
  import { applyTheme, initTheme } from '@/core/theme'
  import { resetModalStack } from '@/composables/useModalStack'
  import { configureAudio, disposeAudio, playSfx, unlockAudio } from '@/core/audio'
  import TopStatusBar from '@/components/common/TopStatusBar.vue'
  import BottomNavigation from '@/components/common/BottomNavigation.vue'
  import ToastHost from '@/components/common/ToastHost.vue'
  import TreasureCeremony from '@/components/common/TreasureCeremony.vue'
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
  // 登出不重置 game.started(内存态仍属本账号,落盘不串),顶栏/底栏须另看登录态,
  // 否则退出后登录页仍顶着上一位道友的道号与资源,底栏点了还会被守卫弹回
  const auth = useAuthStore()
  const ui = useUiStore()
  const settings = useSettingsStore()
  const route = useRoute()
  const router = useRouter()

  /** 内容区滚动宿主:滚动条在常驻的 main 上,不在 window */
  const scrollHost = ref<HTMLElement | null>(null)

  /**
   * 切页归零滚动 + 焦点回到内容区。
   * 滚动:main 常驻,scrollTop 会被下一页继承;router 的 scrollBehavior 只管 window,不顶用。
   * 焦点:不挪的话键盘/读屏焦点还停在旧页那个已经不在 DOM 里的链接上,浏览器把它甩回 body,
   * 下一次 Tab 从文档开头重新数起,读屏也不播报「换页了」。main 上 tabindex=-1 只让它可编程聚焦、不进 Tab 序。
   * 挂 before-enter 而非 watch(route):out-in 下此刻旧页已离场,不会跳回顶部。
   */
  function resetScroll(): void {
    if (scrollHost.value) scrollHost.value.scrollTop = 0
  }

  /**
   * 焦点挪进内容区,须在 after-enter,不能在 before-enter:
   * out-in 下 beforeEnter 时旧页还在离场,新页尚未插入,此刻 focus() 会被离场收尾抢回。
   * main 的 tabindex=-1 只让它可编程聚焦、不进 Tab 序。
   */
  function focusContent(): void {
    scrollHost.value?.focus({ preventScroll: true })
  }

  let unsubscribeTheme: () => void = () => undefined
  let unsubscribeSaveFailure: () => void = () => undefined
  let unsubscribeOtherTab: () => void = () => undefined

  /** 网游会话:已登录则连 ws + 拉云端档 + 启动定时推送 */
  async function bootstrapCloud(): Promise<void> {
    if (!auth.loggedIn) return
    connectCloudWs()
    // VIP 状态随会话刷新(GM 发放/续期后,玩家刷新页面即生效)
    void auth.refreshVip().catch(() => undefined)
    const restored = await restoreFromCloud()
    if (restored) return // 云端档已应用并重载
    // 本机已开局但对齐过且本机无未同步进度时,云端更新(别的设备/上一会话末推)即自动接管;
    // 本机可能有未上传进度则回落为提示,绝不悄悄覆盖
    const auto = await autoRestoreIfNewer()
    if (auto) return
    const newerAt = await probeCloudNewer()
    if (newerAt !== null) ui.toast('云端存档比本机新,可在「设置 → 存档」中恢复', 'warn')
    startCloudSync()
    // 云端就绪后领离线托管讨伐所得(restored 分支已重载,由下一次启动领取)
    void collectOfflineBossLedger()
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

  // 会话失效统一出口:kicked=被新设备挤下线(宽限期内最后一推存档),expired=token 彻底失效(密钥变更/改密/过期),
  // banned=账号被封禁(服务端不再收任何请求,绝不做最后一推 —— 也不该再试)
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
    auth.logout()
    ui.toast(
      reason === 'kicked'
        ? '账号已在其他设备登录,本机已下线'
        : reason === 'banned'
          ? '账号已被封禁,云同步已停止'
          : '登录已失效,请重新登录',
      'warn'
    )
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

  // 只在开局后发跨标签心跳:没开局就没有可被覆盖的进度,不必每 4 秒写一次 localStorage
  watch(
    () => game.started,
    started => watchOtherTabSave(started),
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
    // 两页同开时两边各自落盘、后写的整片覆盖先前那份,进度会静默丢失;只在开始那一次报
    unsubscribeOtherTab = subscribeOtherTabSave(active => {
      if (active) ui.toast('存档已在另一页打开', 'warn')
    })
    // VIP 托管离线补推须先于离线结算(补历练会话/闭关到离线窗口,让离线公式整段结算)
    void (async () => {
      await prepOfflineAutoOps()
      engine.start()
      void bootstrapCloud()
    })()
    startAutoOps()
    window.addEventListener('pointerdown', onPointerDown)
  })

  onUnmounted(() => {
    unsubscribeTheme()
    unsubscribeSaveFailure()
    unsubscribeOtherTab()
    watchOtherTabSave(false)
    engine.stop()
    stopAutoOps()
    disconnectCloudWs()
    resetModalStack()
    disposeAudio()
    window.removeEventListener('pointerdown', onPointerDown)
  })
</script>
