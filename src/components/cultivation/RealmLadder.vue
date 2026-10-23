<template>
  <div>
    <!-- 境数刻度:每格均布,界首处立一道界门,各界一眼可分(个数从 REALMS 现算) -->
    <div class="flex items-center" role="list" :aria-label="`仙路 ${cnNumber(realmsCount)} 境`">
      <template v-for="(p, i) in points" :key="p.index">
        <span v-if="p.worldStart && i > 0" class="mx-0.5 h-3 w-px shrink-0 bg-ink/20" aria-hidden="true" />
        <span class="flex min-w-0 flex-1 justify-center">
          <span
            role="listitem"
            class="realm-dot"
            :class="
              p.state === 'done'
                ? 'bg-jade/70'
                : p.state === 'now'
                  ? 'animate-breathe bg-cinnabar ring-2 ring-cinnabar/25'
                  : 'border border-ink/25 bg-transparent'
            "
            :title="p.name"
            :aria-label="p.name"
          />
        </span>
      </template>
    </div>

    <!-- 界段名:人间界 · 仙界 · 神界 · 混沌海,各自钉在自己那段的正中央——
         四界段长不一,均布会把仙界/神界标签偏向段首,段心才对得上段 -->
    <p class="relative mt-1 h-3 text-[9px] leading-none text-ink-faint">
      <span
        v-for="w in worlds"
        :key="w.id"
        class="absolute -translate-x-1/2 whitespace-nowrap"
        :style="{ left: `${w.centerPct}%` }"
      >{{ w.name }}</span>
    </p>
  </div>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import { realmLadderPoints, realmLadderWorlds } from '@/core/realmLadder'
  import { cnNumber } from '@/utils/format'

  const props = defineProps<{
    /** 当前境界索引(major) */
    major: number
  }>()

  const points = computed(() => realmLadderPoints(props.major))
  const worlds = computed(() => realmLadderWorlds())

  /**
   * 境数 —— 从境界表现算,不在标签里写死「21」。
   *
   * 无障碍标签是给读屏软件念的,而它从前与刻度本身脱钩:加一境、减一境,
   * 刻度自己会长会缩(`realmLadderPoints` 读 `REALMS`),标签里那个数字却停在原处 ——
   * 读屏用户听到的境数与实际格子数对不上,而看得见的人永远不会发现。
   */
  const realmsCount = computed(() => points.value.length)
</script>

<style scoped>
  /* 三态点共享的底座:固定 8px,不被 flex 拉伸 */
  .realm-dot {
    height: 8px;
    width: 8px;
    border-radius: 999px;
    flex-shrink: 0;
    transition: background-color 0.3s ease;
  }
</style>
