<template>
  <nav
    class="relative z-20 shrink-0 border-t border-ink/15 bg-paper-deep/95 backdrop-blur"
    :style="`padding-bottom: max(env(safe-area-inset-bottom), ${navInset}px)`"
  >
    <div class="ink-divider absolute -top-px inset-x-0" />
    <div class="grid grid-cols-5">
      <RouterLink
        v-for="tab in TABS"
        :key="tab.name"
        :to="tab.to"
        class="relative flex flex-col items-center gap-0.5 py-2 transition-colors short:gap-0 short:py-1"
        :class="route.name === tab.name ? 'text-cinnabar' : 'text-ink-faint active:text-ink-soft'"
      >
        <span class="transition-transform duration-200" :class="route.name === tab.name ? '-translate-y-0.5 scale-110' : ''">
          <GameIcon :name="tab.icon" :size="20" />
        </span>
        <span class="font-kai text-[11px] tracking-[0.2em] short:text-[10px]">{{ tab.label }}</span>
      </RouterLink>
    </div>
  </nav>
</template>

<script setup lang="ts">
  import { useRoute } from 'vue-router'
  import { useNativeInsets } from '@/composables/useNativeInsets'
  import GameIcon from './GameIcon.vue'

  const route = useRoute()
  // 安卓三键导航栏高度(手势导航与非安卓平台为 0),与 env() 取大者垫底
  const { bottom: navInset } = useNativeInsets()

  const TABS = [
    { name: 'home', label: '洞府', icon: 'mountain', to: '/' },
    { name: 'cultivation', label: '修炼', icon: 'flame', to: '/cultivation' },
    { name: 'adventure', label: '历练', icon: 'swords', to: '/adventure' },
    { name: 'inventory', label: '背包', icon: 'backpack', to: '/inventory' },
    { name: 'character', label: '人物', icon: 'circle-user', to: '/character' }
  ] as const
</script>
