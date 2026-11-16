<template>
  <div class="space-y-3">
    <!-- 门槛与开销:先说清「凭什么能立派、要付什么」,再让人挑道统 -->
    <div class="rounded-md border border-ink/10 bg-paper-deep/50 px-3 py-2.5">
      <div class="flex items-center justify-between gap-2">
        <span class="font-kai text-[12px] tracking-wider text-ink-soft">开宗立派</span>
        <span class="shrink-0 text-[10px] tabular" :class="realmOk ? 'text-jade' : 'text-cinnabar'">
          {{ realmOk ? '已达元婴' : `需${gateName}境` }}
        </span>
      </div>
      <p class="mt-1 text-[10px] leading-relaxed text-ink-faint">
        立派须一次付清开山之资(灵石 {{ formatGN(gn(cost.stone)) }} · 玄铁 {{ cost.ore }} · 悟道 {{ cost.wudao }}),
        道统一经择定,此世不改。
      </p>
      <p v-if="shortLine" class="mt-1 text-[10px] leading-relaxed text-cinnabar">{{ shortLine }}</p>
    </div>

    <!-- 道统三选一 -->
    <div class="space-y-2">
      <button
        v-for="s in SECTS"
        :key="s.id"
        type="button"
        class="card-ink w-full px-3 py-2.5 text-left transition-colors"
        :class="pick === s.id ? 'ring-1 ring-inset ring-cinnabar/40' : ''"
        :aria-pressed="pick === s.id"
        @click="pick = s.id"
      >
        <div class="flex items-start gap-2.5">
          <span class="grid h-9 w-9 shrink-0 place-items-center rounded-md" :class="pick === s.id ? 'bg-cinnabar/10 text-ink' : 'bg-ink/5 text-ink-faint'">
            <GameIcon :name="s.icon" :size="18" />
          </span>
          <div class="min-w-0 grow">
            <p class="font-kai text-[14px] tracking-wider" :class="pick === s.id ? 'text-ink' : 'text-ink-soft'">{{ s.name }}</p>
            <p class="mt-0.5 text-[10px] leading-snug text-ink-faint">{{ s.motto }} · {{ s.desc }}</p>
          </div>
          <GameIcon v-if="pick === s.id" name="shield-check" :size="14" class="mt-0.5 shrink-0 text-cinnabar" />
        </div>
        <!-- 技能一览:只说每层给什么,不列价 -->
        <ul class="mt-1.5 space-y-0.5">
          <li v-for="k in s.skills" :key="k.id" class="flex items-baseline gap-1.5 text-[10px] leading-snug text-ink-faint">
            <span class="shrink-0 text-ink-soft">{{ k.name }}</span>
            <span class="truncate">{{ k.effectText(1) }}(每重)</span>
          </li>
        </ul>
      </button>
    </div>

    <!-- 门派名 -->
    <label class="block">
      <span class="text-[10px] text-ink-faint">门派名({{ SECT_NAME_MIN }}~{{ SECT_NAME_MAX }} 字)</span>
      <input
        v-model="name"
        type="text"
        :maxlength="SECT_NAME_MAX"
        placeholder="例如:青冥剑宗"
        class="mt-1 w-full rounded-md border border-ink/15 bg-paper px-3 py-2 font-kai text-[13px] text-ink outline-none focus:border-cinnabar/40"
      />
    </label>

    <button class="btn-seal w-full" :disabled="!ready" @click="submit()">
      {{ ready ? `立派 · ${pickName}` : blockLine }}
    </button>
  </div>
</template>

<script setup lang="ts">
  import { computed, ref } from 'vue'
  import GameIcon from '@/components/common/GameIcon.vue'
  import { SECTS, SECT_NAME_MAX, SECT_NAME_MIN, type SectId } from '@/data/sect'
  import { REALMS } from '@/data/realms'
  import { SECT_FOUND_MAJOR } from '@/data/sect'
  import { canFound, foundCost, sectNameOk } from '@/core/sectRules'
  import { usePlayerStore } from '@/stores/player'
  import { useResourcesStore } from '@/stores/resources'
  import { useSectStore } from '@/stores/sect'
  import { formatGN } from '@/utils/format'
  import { gn } from '@/utils/gnum'

  const player = usePlayerStore()
  const resources = useResourcesStore()
  const sect = useSectStore()

  const pick = ref<SectId>('taixu')
  const name = ref('')

  const cost = computed(() => foundCost(sect.rate))
  const realmOk = computed(() => canFound(player.major))
  const gateName = computed(() => REALMS[SECT_FOUND_MAJOR]?.name ?? '元婴')
  const pickName = computed(() => SECTS.find(s => s.id === pick.value)?.name ?? '')

  const stoneShort = computed(() => {
    const need = gn(cost.value.stone)
    return resources.hasStone(need) ? null : need
  })
  const oreShort = computed(() => Math.max(0, cost.value.ore - resources.ore))
  const wudaoShort = computed(() => Math.max(0, cost.value.wudao - resources.wudao))

  /** 一句短板:先报境界,再报三样里差的那几样 */
  const shortLine = computed(() => {
    const parts: string[] = []
    if (!realmOk.value) parts.push(`境界未达${gateName.value}`)
    if (stoneShort.value !== null) parts.push(`灵石尚差 ${formatGN(stoneShort.value)}`)
    if (oreShort.value > 0) parts.push(`玄铁尚差 ${oreShort.value}`)
    if (wudaoShort.value > 0) parts.push(`悟道点尚差 ${wudaoShort.value}`)
    return parts.join(' · ')
  })

  const nameOk = computed(() => sectNameOk(name.value))
  const ready = computed(() => realmOk.value && nameOk.value && shortLine.value === '' && !sect.pending)

  const blockLine = computed(() => {
    if (!realmOk.value) return `需${gateName.value}境`
    if (!nameOk.value) return `门派名须 ${SECT_NAME_MIN}~${SECT_NAME_MAX} 字`
    if (shortLine.value !== '') return '开山之资不足'
    return '立派'
  })

  function submit(): void {
    if (!ready.value) return
    void sect.found(pick.value, name.value)
  }
</script>
