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
          <span class="shrink-0 text-[10px] tabular text-ink-faint">{{ veinName }} · {{ level }}/{{ cap }} 重</span>
          <span v-if="topped" class="shrink-0 rounded border border-gold-ink/40 bg-gold-ink/10 px-1.5 py-0.5 text-[10px] leading-none text-ink">圆满</span>
          <span v-else-if="locked" class="shrink-0 rounded bg-ink/6 px-1.5 py-0.5 text-[10px] leading-none text-ink-faint">未启</span>
        </p>
      </div>
    </div>

    <p class="mt-2 grow text-[11px] leading-relaxed text-ink-faint">
      {{ level > 0 ? def.effectText(level) : def.desc }}
    </p>
    <p v-if="level > 0 && !atMax" class="mt-1 text-[10px] leading-relaxed text-ink-faint">
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
  import { sectOfSkill, type SectSkillDef } from '@/data/sect'
  import { skillCapNextHall, skillCost, skillLevelCap, skillUnlocked } from '@/core/sectRules'
  import { useSectStore } from '@/stores/sect'

  const props = defineProps<{ def: SectSkillDef }>()

  const sect = useSectStore()
  const level = computed(() => sect.skillLevel(props.def.id))
  /** 出自哪一脉:三脉合在一门里,标一行小字,好让玩家知道自己在练哪家的东西 */
  const veinName = computed(() => sectOfSkill(props.def.id)?.name ?? '')

  /** 上限由山门定:基础五重,山门每 20 级再开五重(与服务端同一把尺) */
  const hallLevel = computed(() => sect.buildingLevel('hall'))
  const cap = computed(() => skillLevelCap(hallLevel.value))

  /** 同层三选一:上一层三脉任一门到二重即开下一层 */
  const locked = computed(() => !skillUnlocked(sect.state.skills, props.def.id))

  const cost = computed(() => skillCost(props.def.id, level.value, sect.rate, hallLevel.value) ?? 0)
  const atMax = computed(() => level.value >= cap.value)
  /** 真·圆满:不仅顶到当前上限,而且山门已开尽(百级,三十重) */
  const topped = computed(() => atMax.value && skillCapNextHall(hallLevel.value) === null)
  const canLearn = computed(() => !atMax.value && !locked.value && sect.personal >= cost.value && !sect.pending)

  const blockLine = computed(() => {
    if (atMax.value) {
      const next = skillCapNextHall(hallLevel.value)
      return next === null ? '已圆满' : `山门 ${next} 级可续修`
    }
    if (locked.value) return '上一层任一门须到二重'
    return `个人贡献不足 · 差 ${Math.max(0, cost.value - sect.personal)}`
  })

  function learn(): void {
    if (!canLearn.value) return
    void sect.learn(props.def.id)
  }
</script>
