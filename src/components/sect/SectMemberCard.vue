<template>
  <div class="card-ink px-3 py-3">
    <div class="flex items-baseline justify-between gap-2">
      <span class="font-kai text-[12px] tracking-wider text-ink-soft">门人</span>
      <span class="shrink-0 text-[10px] tabular text-ink-faint">{{ sect.memberCount }}/{{ sect.capacity }}</span>
    </div>

    <!--
      门册、候批与去留都收进一处弹窗:门派页本来就长(概览 + 捐献 + 五座建筑 + 十五门技能),
      几十行门人铺在中间,营造与技能得翻半天。这里只留一行计数与一个入口。
    -->
    <p class="mt-1 text-[10px] leading-relaxed text-ink-faint">
      门册可查可翻;有职者还能审候批、逐人,掌门另可任职罢免与解散门派。
    </p>

    <button class="btn-ghost mt-2 w-full !py-1.5 !text-[12px]" @click="open = true">
      <span class="whitespace-nowrap">查看门人</span>
      <span v-if="sect.canReview && sect.applyCount > 0" class="whitespace-nowrap text-cinnabar">
        · 候批 {{ sect.applyCount }}
      </span>
    </button>

    <SectMemberDialog v-model:open="open" />
  </div>
</template>

<script setup lang="ts">
  import { ref } from 'vue'
  import SectMemberDialog from '@/components/sect/SectMemberDialog.vue'
  import { useSectStore } from '@/stores/sect'

  const sect = useSectStore()
  const open = ref(false)
</script>
