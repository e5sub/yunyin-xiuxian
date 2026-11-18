<template>
  <div class="card-ink px-3 py-2.5">
    <div class="flex items-start justify-between gap-2">
      <div class="flex min-w-0 items-start gap-2.5">
        <span class="grid h-9 w-9 shrink-0 place-items-center rounded-md" :class="level > 0 ? 'bg-gold-ink/10 text-ink' : 'bg-ink/5 text-ink-faint'">
          <GameIcon :name="def.icon" :size="17" />
        </span>
        <p class="min-w-0">
          <span class="block truncate font-kai text-[14px] leading-snug" :class="level > 0 ? 'text-ink' : 'text-ink-soft'">{{ def.name }}</span>
          <span class="mt-0.5 block text-[10px] text-ink-faint">绝学 · 全门同享</span>
        </p>
      </div>
      <span class="shrink-0 text-[10px] tabular" :class="level > 0 ? 'text-gold-ink' : 'text-ink-faint'">
        {{ level > 0 ? `${level}/${maxLevel} 重` : '未研' }}
      </span>
    </div>
    <p class="mt-2 grow text-[11px] leading-relaxed text-ink-faint">{{ def.desc }}</p>
    <p class="mt-1 text-[10px] leading-relaxed" :class="level > 0 ? 'text-jade' : 'text-ink-faint'">
      {{ level > 0 ? `当前:${def.effectText(level)}` : `研成一重:${def.effectText(1)}` }}
      <span v-if="level > 0 && level < maxLevel" class="text-ink-faint"> · 下一重 {{ def.effectText(level + 1) }}</span>
    </p>

    <button
      v-if="sect.canBuild"
      class="btn-ghost mt-2 w-full !py-1.5 !text-[12px]"
      :disabled="!canStart"
      :aria-label="canStart ? undefined : blockLine"
      @click="research()"
    >
      <template v-if="canStart">
        <span class="whitespace-nowrap">{{ level > 0 ? '续研' : '研 究' }} ·</span>
        <span class="whitespace-nowrap">{{ cost }} 门派库</span>
        <span class="whitespace-nowrap">· 至 {{ level + 1 }} 重</span>
      </template>
      <template v-else>{{ blockLine }}</template>
    </button>
    <p v-else-if="level < maxLevel" class="mt-2 text-center text-[10px] text-ink-faint">由掌门、副掌门或长老研究,研成后全门同享</p>
  </div>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import GameIcon from '@/components/common/GameIcon.vue'
  import type { SectArtDef } from '@/data/sect'
  import { artCost, artMaxLevel } from '@/core/sectRules'
  import { useSectStore } from '@/stores/sect'

  const props = defineProps<{ def: SectArtDef }>()

  const sect = useSectStore()
  const maxLevel = artMaxLevel()

  /** 本门这门绝学研到了几重:state.arts 记 id → 重数 */
  const level = computed(() => sect.state.arts[props.def.id] ?? 0)
  /** 价签吃山门减免、不吃 VIP(门派公账,见 artCost) */
  const cost = computed(() => artCost(props.def.id, level.value + 1, sect.state.buildings.hall ?? 0) ?? 0)
  const canStart = computed(
    () => sect.canBuild && level.value < maxLevel && cost.value > 0 && sect.pool >= cost.value && !sect.pending
  )
  const blockLine = computed(() => {
    if (level.value >= maxLevel) return '已臻圆满'
    if (sect.pending) return '正在研究'
    if (sect.pool < cost.value) return `门派库不足 · 差 ${Math.max(0, cost.value - sect.pool)}`
    return '尚不可研究'
  })

  function research(): void {
    if (!canStart.value) return
    void sect.researchArt(props.def.id)
  }
</script>
