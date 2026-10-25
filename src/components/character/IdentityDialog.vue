<template>
  <BaseModal :open="open" :title="`修行画像 · 「${identity?.epithet ?? '云隐散人'}」`" @close="emit('close')">
    <div v-if="identity" class="space-y-2.5">
      <p class="text-[12px] leading-relaxed text-ink-soft">{{ identity.narrative }}</p>
      <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
        <p v-for="r in identityRoots" :key="r.label" class="flex justify-between">
          <span class="text-ink-faint">{{ r.label }}</span>
          <span class="text-ink-soft">{{ r.value }}</span>
        </p>
      </div>
      <p v-if="identity.roots.fortunes.length" class="text-[11px] text-ink-faint">
        机缘印记:{{ identity.roots.fortunes.map(f => f.title).join(' · ') }}
      </p>
    </div>
    <template #footer>
      <button class="btn-seal w-full" @click="emit('close')">收 卷</button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import { buildIdentity } from '@/core/identityService'
  import BaseModal from '@/components/common/BaseModal.vue'

  /** 修行画像弹窗。identity 与宿主各算一份(buildIdentity() 是纯 core 调用),不穿 prop */
  defineProps<{ open: boolean }>()
  const emit = defineEmits<{ close: [] }>()

  const identity = computed(() => buildIdentity())

  /** 四项目录;师承空值须与人物页入口卡同为「未拜师」 */
  const identityRoots = computed(() => {
    const r = identity.value?.roots
    return [
      { label: '师承', value: r?.mentor?.name ?? '未拜师' },
      { label: '道途', value: r?.daoPath ?? '未择' },
      { label: '流派', value: r?.build ?? '未成' },
      { label: '悟道', value: r?.branches.join('、') || '未定' }
    ]
  })
</script>
