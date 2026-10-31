<template>
  <!--
    iOS 存档风险提示:仅「iOS 且还没装到主屏幕」时出现(见 utils/platform.ts);安卓 APK 与 Windows 桌面用应用自己的存储,不提示。
    主页(默认)「知道了」关掉后不再出现;设置页(permanent)无关闭按钮,常驻。
  -->
  <div v-if="visible" class="card-ink border-azure/30 px-4 py-3">
    <p class="font-kai text-[13px] tracking-wider text-ink">添加到主屏幕</p>
    <p class="mt-1.5 text-[11px] leading-relaxed text-ink-faint">七天未打开会清除存档</p>
    <p class="mt-1.5 text-[11px] leading-relaxed text-ink-soft">Safari → 分享 → 「添加到主屏幕」</p>
    <button
      v-if="!permanent"
      class="-my-1 mt-2 rounded px-2 py-2 text-[11px] text-ink-faint ring-1 ring-inset ring-ink/25 active:text-ink"
      @click="dismiss"
    >知道了</button>
  </div>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import { probeEnv, shouldSuggestInstall } from '@/utils/platform'
  import { useSettingsStore } from '@/stores/settings'

  const props = withDefaults(defineProps<{ permanent?: boolean }>(), { permanent: false })

  const settings = useSettingsStore()

  const visible = computed(() => shouldSuggestInstall(probeEnv()) && (props.permanent || !settings.installNoticeDismissed))

  function dismiss(): void {
    settings.installNoticeDismissed = true
  }
</script>
