<template>
  <!-- 吸顶外壳(尺寸与遮罩见 .tab-rail) -->
  <div class="tab-rail">
    <!-- 不加 aria-controls:面板内容是父级槽位,无稳定 id -->
    <div
      class="card-ink relative flex overflow-hidden p-1"
      role="tablist"
      aria-label="页面"
      @keydown="onTablistKeydown"
    >
      <!-- 墨块滑动指示 -->
      <span
        class="pointer-events-none absolute inset-y-1 left-1 rounded-md bg-ink shadow transition-transform duration-300"
        :style="{
          width: `calc((100% - 8px) / ${tabs.length})`,
          transform: `translateX(${activeIdx * 100}%)`,
          transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)'
        }"
      />
      <button
        v-for="t in tabs"
        :key="t.id"
        role="tab"
        :aria-selected="model === t.id"
        :tabindex="model === t.id ? 0 : -1"
        class="relative z-10 flex-1 rounded-md py-1.5 font-kai text-[13px] tracking-[0.2em] transition-colors duration-200"
        :class="model === t.id ? 'text-paper' : 'text-ink-faint active:text-ink-soft'"
        @click="model = t.id"
      >
        {{ t.label }}
        <span
          v-if="t.dot"
          class="absolute right-1.5 top-1 h-1.5 w-1.5 rounded-full bg-cinnabar"
          :class="model === t.id ? '' : 'animate-breathe'"
        />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts" generic="T extends string">
  import { computed } from 'vue'

  const props = defineProps<{
    tabs: readonly { id: T; label: string; dot?: boolean }[]
  }>()

  const model = defineModel<T>({ required: true })

  const activeIdx = computed(() =>
    Math.max(
      0,
      props.tabs.findIndex(t => t.id === model.value)
    )
  )

  /** WAI-ARIA tabs 键盘导航(roving tabindex):左右键回绕,Home/End 直达首尾;只响应落在 tab 按钮上的按键 */
  function onTablistKeydown(e: KeyboardEvent): void {
    if ((e.target as HTMLElement).getAttribute?.('role') !== 'tab') return
    const count = props.tabs.length
    if (count === 0) return

    let next = activeIdx.value
    switch (e.key) {
      case 'ArrowLeft':
        next -= 1
        break
      case 'ArrowRight':
        next += 1
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = count - 1
        break
      default:
        return
    }
    next = (next + count) % count
    e.preventDefault() // 别让方向键滚动页面
    const target = props.tabs[next]
    if (target === undefined) return // 仅为类型收窄
    model.value = target.id
    ;(e.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
  }
</script>
