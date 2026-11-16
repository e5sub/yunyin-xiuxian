<template>
  <div class="card-ink flex flex-col px-3 py-3">
    <div class="flex items-start gap-2.5">
      <span class="grid h-9 w-9 shrink-0 place-items-center rounded-md" :class="level > 0 ? 'bg-gold-ink/10 text-ink' : 'bg-ink/5 text-ink-faint'">
        <GameIcon :name="props.def.row >= 4 ? 'sparkles' : 'scroll'" :size="17" />
      </span>
      <div class="min-w-0 grow">
        <p class="truncate font-kai text-[14px] leading-snug" :title="def.name" :class="level > 0 ? 'text-ink' : 'text-ink-soft'">
          {{ def.name }}
        </p>
        <p class="mt-0.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
          <span class="shrink-0 text-[10px] tabular text-ink-faint">第 {{ def.row }} 层 · {{ level }}/{{ SECT_SKILL_MAX_LEVEL }} 重</span>
          <span v-if="level >= SECT_SKILL_MAX_LEVEL" class="shrink-0 rounded border border-gold-ink/40 bg-gold-ink/10 px-1.5 py-0.5 text-[10px] leading-none text-ink">圆满</span>
          <span v-else-if="locked" class="shrink-0 rounded bg-ink/6 px-1.5 py-0.5 text-[10px] leading-none text-ink-faint">未启</span>
        </p>
      </div>
    </div>

    <p class="mt-2 grow text-[11px] leading-relaxed text-ink-faint">
      {{ level > 0 ? def.effectText(level) : def.desc }}
    </p>
    <p v-if="level > 0 && level < SECT_SKILL_MAX_LEVEL" class="mt-1 text-[10px] leading-relaxed text-ink-faint">
      下一重:<span class="text-ink-soft">{{ def.effectText(level + 1) }}</span>
    </p>

    <button
      class="btn-ghost mt-2 w-full !py-1.5 !text-[12px]"
      :disabled="!canLearn"
      :aria-label="canLearn ? undefined : blockLine"
      @click="learn()"
    >
      <template v-if="canLearn">
        <span class="whitespace-nowrap">修 习 ·</span>
        <span class="whitespace-nowrap">{{ cost }} 贡献</span>
      </template>
      <template v-else>{{ blockLine }}</template>
    </button>
  </div>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import GameIcon from '@/components/common/GameIcon.vue'
  import { SECT_SKILL_MAX_LEVEL, type SectSkillDef } from '@/data/sect'
  import { skillCost, skillUnlockNeed } from '@/core/sectRules'
  import { useSectStore } from '@/stores/sect'

  const props = defineProps<{ def: SectSkillDef }>()

  const sect = useSectStore()
  const level = computed(() => sect.skillLevel(props.def.id))

  /** 上一层须到二重;第一层无条件 */
  const need = computed(() => skillUnlockNeed(props.def.id))
  const locked = computed(() => {
    const n = need.value
    return n !== null && sect.skillLevel(n.id) < n.level
  })

  const cost = computed(() => skillCost(props.def.id, level.value, sect.rate) ?? 0)
  const atMax = computed(() => level.value >= SECT_SKILL_MAX_LEVEL)
  const canLearn = computed(() => !atMax.value && !locked.value && sect.personal >= cost.value && !sect.pending)

  const blockLine = computed(() => {
    if (atMax.value) return '已圆满'
    if (locked.value) {
      const n = need.value!
      return `须先将上一层练到 ${n.level} 重`
    }
    return `个人贡献不足 · 差 ${Math.max(0, cost.value - sect.personal)}`
  })

  function learn(): void {
    if (!canLearn.value) return
    void sect.learn(props.def.id)
  }
</script>
