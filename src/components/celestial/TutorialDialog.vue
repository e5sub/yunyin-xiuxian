<template>
  <!-- 首次登真仙·终局导览 -->
  <BaseModal :open="open" title="登临真仙" :closable="false">
    <div class="space-y-2.5 text-[13px] leading-relaxed">
      <p class="text-ink-soft">
        玄铁、残页、灵石等 →
        <!-- 须是 button:无 href 的 <a> 不在 Tab 序列里 -->
        <button
          type="button"
          class="-my-2 inline-block rounded px-1.5 py-2 align-baseline text-azure ring-1 ring-inset ring-azure/30 active:opacity-60"
          @click="emit('close')"
        >
          天道熔炉
        </button>
        → 道源
      </p>
      <p class="text-ink-soft">
        道源:<b class="text-cinnabar">此世</b>消耗 · 远征、立契、试炼
      </p>
      <p class="text-ink-soft">
        道果:道源凝成 · <b class="text-violet-ink">跨世</b>保留
      </p>
    </div>
    <template #footer>
      <button class="btn-seal w-full" @click="emit('close')">知道了</button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import BaseModal from '@/components/common/BaseModal.vue'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()
</script>
