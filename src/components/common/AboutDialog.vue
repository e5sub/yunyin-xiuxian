<template>
  <BaseModal :open="open" title="关于我们" @close="$emit('close')">
    <div class="space-y-3 text-[12px] leading-relaxed">
      <p class="text-ink-faint">《云隐修仙录》—— 一念修行,云深不知处。</p>
      <div class="card-ink px-3 py-2">
        <p class="text-[10px] text-ink-faint">当前版本</p>
        <p class="font-kai text-[14px] text-ink tabular">v{{ version }}</p>
      </div>
      <div class="card-ink px-3 py-2">
        <p class="text-[10px] text-ink-faint">开源仓库</p>
        <!-- 补成内联块:触控高度 30px -->
        <a
          href="https://github.com/setube/yunyin-xiuxian"
          target="_blank"
          rel="noopener noreferrer"
          class="inline-block py-1.5 text-azure underline break-all"
        >
          github.com/setube/yunyin-xiuxian
        </a>
      </div>
      <div class="card-ink px-3 py-2">
        <p class="text-[10px] text-ink-faint">QQ 交流群</p>
        <p class="text-ink tabular">920930589</p>
      </div>
    </div>
    <template #footer>
      <button class="btn-seal w-full" @click="$emit('close')">知道了</button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
  import BaseModal from './BaseModal.vue'
  import pkg from '../../../package.json'

  defineProps<{
    open: boolean
  }>()

  defineEmits<{
    close: []
  }>()

  const version = pkg.version
</script>
