<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { getCurrentEnlightenment, chooseEnlightenment, dismissEnlightenment } from '@/core/earlyGameService'
import { gameNow } from '@/core/enginePause'
import { useGameClock } from '@/composables/useGameClock'
import { enlightenmentOptionText } from '@/ui/enlightenmentText'
import type { EnlightenmentEvent } from '@/types'
import BaseModal from '@/components/common/BaseModal.vue'

/*
 * 顿悟弹窗:全屏浮层只走 BaseModal(语义、焦点、Esc/背板关闭、排版自检尺子一并继承)。
 * 倒计时每秒刷一次,到点由引擎收场;「忽略」= 关掉即散。
 */
const event = ref<EnlightenmentEvent | null>(null)
const remaining = ref(0)

function refresh() {
  event.value = getCurrentEnlightenment()
  if (event.value) {
    remaining.value = Math.max(0, Math.ceil((event.value.expiresAt - gameNow()) / 1000))
  }
}

function handleChoose(index: number) {
  chooseEnlightenment(index)
  event.value = null
}

function handleIgnore() {
  dismissEnlightenment() // 清模块级事件,否则轮询会把它弹回来
  event.value = null
}

onMounted(() => {
  refresh()
})

// 轮询随心跳冻结(与 useNow 同一条口径)
useGameClock(refresh, 1000)

const show = computed(() => event.value !== null)
</script>

<template>
  <!-- 背板/Esc/关闭键一律等于「忽略」 -->
  <BaseModal :open="show" title="悟道顿悟" @close="handleIgnore">
    <p class="flex items-center justify-end text-[11px]">
      <span role="status" aria-live="polite" aria-atomic="true" class="tabular text-gold-ink">{{ remaining }} 秒后自散</span>
    </p>
    <div class="mt-3 space-y-2">
      <button
        v-for="(opt, idx) in event?.options ?? []"
        :key="idx"
        class="w-full rounded-lg border border-ink/25 px-4 py-2.5 text-left transition-all active:scale-98 active:bg-ink/5"
        @click="handleChoose(idx)"
      >
        <span class="block font-kai text-[14px] tracking-widest text-ink">{{ opt.label }}</span>
        <span class="mt-0.5 block text-[11px] leading-relaxed text-ink-faint">{{ enlightenmentOptionText(opt) }}</span>
      </button>
    </div>
    <template #footer>
      <button class="btn-ghost w-full" @click="handleIgnore">忽 略</button>
    </template>
  </BaseModal>
</template>
