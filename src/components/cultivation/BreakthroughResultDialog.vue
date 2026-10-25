<template>
  <!-- 突破成功:全屏墨色冲击波 -->
  <Teleport to="body">
    <div v-if="view?.success" class="ink-wave" />
  </Teleport>
  <BaseModal :open="view !== null" :closable="false" aria-label="突破结果">
    <div v-if="view" class="text-center">
      <div class="relative mx-auto mt-2 h-20 w-20">
        <div v-if="view.success" class="ink-burst">
          <span v-for="i in 10" :key="i" />
        </div>
        <span v-if="view.success" class="burst-ring" />
        <div
          class="grid h-20 w-20 place-items-center rounded-full border-2 font-kai text-4xl animate-ink-pop"
          :class="
            view.success ? 'border-cinnabar text-cinnabar bg-cinnabar/5 animate-glow-pulse' : 'border-ink-faint text-ink-faint bg-ink/5'
          "
        >
          {{ view.success ? '破' : '滞' }}
        </div>
      </div>
      <p class="mt-3 font-kai text-lg tracking-[0.3em] text-ink">
        {{ view.success ? '突破成功' : '突破失败' }}
      </p>
      <p class="mt-1 text-[13px] text-ink-soft">
        {{ view.fromLabel }}
        <span class="mx-1 text-ink-faint">→</span>
        <span :class="view.success ? 'text-cinnabar font-kai' : 'text-ink-faint'">{{ view.toLabel }}</span>
      </p>
      <div v-if="view.tribulationLog.length" class="mt-3 max-h-40 overflow-y-auto rounded-md bg-ink/4 px-3 py-2 text-left">
        <p v-for="(line, i) in view.tribulationLog" :key="i" class="py-0.5 text-[12px] leading-relaxed text-ink-soft">
          {{ line }}
        </p>
      </div>
      <p v-if="view.message" class="mt-3 text-[12px] leading-relaxed text-ink-faint">{{ view.message }}</p>
    </div>
    <template #footer>
      <button class="btn-seal w-full" @click="close">知道了</button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import { useUiStore } from '@/stores/ui'
  import BaseModal from '@/components/common/BaseModal.vue'

  const ui = useUiStore()

  const view = computed(() => ui.breakthrough)

  function close(): void {
    ui.breakthrough = null
  }
</script>
