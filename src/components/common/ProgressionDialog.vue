<template>
  <BaseModal :open="open" title="数值体系" @close="$emit('close')">
    <div class="space-y-3 text-[12px] leading-relaxed">
      <div class="card-ink px-3 py-2">
        <p class="text-[10px] text-ink-faint">每境复利(人间界 / 界外)</p>
        <div class="mt-1.5 space-y-1.5">
          <div v-for="a in PROGRESSION_AXES" :key="a.id" class="flex items-start gap-2">
            <span class="w-[104px] shrink-0 text-ink-soft">{{ a.name }}</span>
            <span class="w-[92px] shrink-0 tabular text-ink">
              ×{{ a.mortal.toFixed(1) }} / ×{{ a.outer.toFixed(1) }}
            </span>
            <span class="min-w-0 grow text-[10px] text-ink-faint">{{ a.note }}</span>
          </div>
        </div>
      </div>

      <div class="card-ink px-3 py-2">
        <p class="text-[10px] text-ink-faint">净耗时(修为需求 ÷ 修炼速度)</p>
        <p class="mt-1 text-ink-soft tabular">
          人间界 ×{{ MORTAL_TIME_PER_MAJOR.toFixed(2) }} / 境 · 界外 ×{{ OUTER_TIME_PER_MAJOR.toFixed(2) }} / 境
        </p>
        <p class="mt-1 text-[10px] text-ink-faint">
          界外:渡劫之上,第 {{ PROGRESSION_NOTES.worldBreakMajor + 1 }} 境起
        </p>
      </div>

      <!-- 花费同样复利,非线性涨价 -->
      <div class="card-ink px-3 py-2">
        <p class="text-[10px] text-ink-faint">花费倍率</p>
        <div class="mt-1.5 space-y-1">
          <div v-for="c in COST_CURVES" :key="c.id" class="flex items-start gap-2">
            <span class="w-[92px] shrink-0 text-ink-soft">{{ c.name }}</span>
            <span class="w-[74px] shrink-0 tabular text-ink">×{{ c.growth.toFixed(2) }}/{{ c.unit.slice(-1) }}</span>
            <span class="min-w-0 grow text-[10px] text-ink-faint">{{ c.note }}</span>
          </div>
        </div>
      </div>

      <div class="card-ink px-3 py-2">
        <p class="text-[10px] text-ink-faint">积余</p>
        <ul class="mt-1 space-y-1">
          <li v-for="line in PROGRESSION_NOTES.banking" :key="line" class="text-ink-soft">· {{ line }}</li>
        </ul>
      </div>

      <div class="card-ink px-3 py-2">
        <p class="text-[10px] text-ink-faint">境界名的出处</p>
        <ul class="mt-1 space-y-1">
          <li v-for="line in PROGRESSION_NOTES.basis" :key="line" class="text-ink-soft">· {{ line }}</li>
        </ul>
      </div>

      <!-- 术数四门:时机各占一层 -->
      <div class="card-ink px-3 py-2">
        <p class="text-[10px] text-ink-faint">术数四门</p>
        <div class="mt-1.5 space-y-1.5">
          <div v-for="s in SORCERY_LAYERS" :key="s.id" class="flex items-start gap-2">
            <span class="w-[84px] shrink-0 text-ink-soft">{{ s.name }}</span>
            <span class="min-w-0 grow">
              <span class="block text-[10px] text-ink-faint">{{ s.cadence }} · 代价:{{ s.cost }}</span>
              <span class="block text-[10px] leading-relaxed text-ink-faint">{{ s.note }}</span>
            </span>
          </div>
        </div>
        <p class="mt-1.5 text-[10px] leading-relaxed text-ink-soft">{{ SORCERY_SUMMARY }}</p>
      </div>

      <!-- 寿元:界域内复利,跨界一次大跃 -->
      <div class="card-ink px-3 py-2">
        <p class="text-[10px] text-ink-faint">寿元</p>
        <div class="mt-1.5 space-y-1">
          <div v-for="l in LIFESPAN_CURVES" :key="l.world" class="flex items-center gap-2">
            <span class="w-[64px] shrink-0 text-ink-soft">{{ l.world }}</span>
            <span class="tabular text-ink">起点 {{ formatGN(l.base) }} 载 · 每境 ×{{ l.growth.toFixed(1) }}</span>
          </div>
        </div>
        <p class="mt-1.5 text-[10px] text-ink-faint">
          渡劫→真仙:约 ×{{ ascensionLeap() }};入神界、入混沌海亦各跃一档
        </p>
      </div>

      <div class="card-ink px-3 py-2">
        <p class="text-[10px] text-ink-faint">突破与天劫</p>
        <ul class="mt-1 space-y-1">
          <li v-for="line in PROGRESSION_NOTES.breakthrough" :key="line" class="text-ink-soft">· {{ line }}</li>
        </ul>
      </div>
    </div>
    <template #footer>
      <button class="btn-seal w-full" @click="$emit('close')">知道了</button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
  import BaseModal from './BaseModal.vue'
import {
  COST_CURVES,
  LIFESPAN_CURVES,
  MORTAL_TIME_PER_MAJOR,
    OUTER_TIME_PER_MAJOR,
  PROGRESSION_AXES,
    PROGRESSION_NOTES,
    SORCERY_LAYERS,
    SORCERY_SUMMARY
} from '@/data/progressionDoc'
import { formatGN } from '@/utils/format'
import { ascensionLeap } from '@/data/realms'

  defineProps<{ open: boolean }>()
  defineEmits<{ close: [] }>()

</script>
