<template>
  <!--
    PC 左栏。只在 ≥1024px 出现(hidden lg:flex):移动端仍走底栏,
    两处都不靠 JS 判设备 —— 窗口拖宽拖窄即刻换,不必刷新。
  -->
  <nav
    aria-label="主菜单"
    class="hidden w-[216px] shrink-0 flex-col border-r border-ink/10 bg-paper-deep/50 lg:flex"
  >
    <div class="shrink-0 px-4 pb-3 pt-4">
      <div class="flex items-center gap-2">
        <span class="seal-face grid h-6 w-6 shrink-0 place-items-center rounded bg-cinnabar font-kai text-[12px]">隐</span>
        <span class="truncate font-kai text-[14px] tracking-[0.16em] text-ink">云隐修仙录</span>
      </div>
      <!-- 道号与境界:顶栏已经有一份,但左栏是 PC 上的视觉锚点,空着反而像没登录 -->
      <p class="mt-2 truncate text-[11px] text-ink-faint">{{ player.name }} · {{ player.realmName }}</p>
    </div>
    <div class="ink-divider mx-4 shrink-0" />

    <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3">
      <template v-for="group in groups" :key="group.title">
        <p class="px-2 pb-1 pt-3 text-[10px] tracking-[0.2em] text-ink-faint">{{ group.title }}</p>
        <RouterLink
          v-for="item in group.items"
          :key="item.name"
          :to="item.to"
          class="relative flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] transition-colors"
          :class="route.name === item.name ? 'bg-ink/8 text-cinnabar' : 'text-ink-soft hover:bg-ink/5 hover:text-ink'"
          :aria-current="route.name === item.name ? 'page' : undefined"
        >
          <GameIcon :name="item.icon" :size="15" class="shrink-0" />
          <span class="truncate font-kai tracking-[0.12em]">{{ item.label }}</span>
          <!-- 新发布说明圆点:与顶栏的齿轮同一处状态,PC 上齿轮只在顶栏右上角 -->
          <span
            v-if="item.name === 'settings' && settings.hasUnseenRelease"
            class="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-cinnabar"
            aria-hidden="true"
          />
        </RouterLink>
      </template>
    </div>
  </nav>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import { useRoute } from 'vue-router'
  import { usePlayerStore } from '@/stores/player'
  import { useSettingsStore } from '@/stores/settings'
  import { WORLD_BREAK_MAJOR } from '@/data/realms'
  import { DESKTOP_NAV } from '@/ui/desktopNav'
  import GameIcon from './GameIcon.vue'

  const route = useRoute()
  const player = usePlayerStore()
  const settings = useSettingsStore()

  // 天界要飞升后才出现:未破界时点进去会被路由守卫弹回,列在栏里只是噪音
  const groups = computed(() =>
    DESKTOP_NAV.map(group => ({
      title: group.title,
      items: group.items.filter(item => !item.needWorldBreak || player.major >= WORLD_BREAK_MAJOR)
    }))
  )
</script>
