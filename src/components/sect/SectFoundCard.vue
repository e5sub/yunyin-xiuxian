<template>
  <div class="space-y-3">
    <!-- 门槛与开销:先说清「凭什么能立派、要付什么」 -->
    <div class="rounded-md border border-ink/10 bg-paper-deep/50 px-3 py-2.5">
      <div class="flex items-center justify-between gap-2">
        <span class="font-kai text-[12px] tracking-wider text-ink-soft">开宗立派</span>
        <span class="shrink-0 text-[10px] tabular" :class="realmOk ? 'text-jade' : 'text-cinnabar'">
          {{ realmOk ? '已达元婴' : `需${gateName}境` }}
        </span>
      </div>
      <p class="mt-1 text-[10px] leading-relaxed text-ink-faint">
        立派须一次付清开山之资(灵石 {{ formatGN(gn(cost.stone)) }} · 玄铁 {{ cost.ore }} · 悟道 {{ cost.wudao }}),
        名字一经定下,此世不改。
      </p>
      <p v-if="shortLine" class="mt-1 text-[10px] leading-relaxed text-cinnabar">{{ shortLine }}</p>
    </div>

    <!-- 门中所藏:三脉十五门,不再选道统 -->
    <div class="rounded-md border border-ink/10 bg-paper-deep/40 px-3 py-2.5">
      <p class="font-kai text-[12px] tracking-wider text-ink-soft">门中所藏</p>
      <p class="mt-1 text-[10px] leading-relaxed text-ink-faint">
        三脉之法同在一门 —— 剑、丹、阵皆可修习,不看开派人的出身。每层三选一,上一层任一门练到二重即开下一层。
      </p>
      <ul class="mt-1.5 space-y-0.5">
        <li v-for="[row, names] in rows" :key="row" class="flex items-baseline gap-1.5 text-[10px] leading-snug text-ink-faint">
          <span class="shrink-0 text-ink-soft">第 {{ row }} 层</span>
          <span class="truncate">{{ names.join(' · ') }}</span>
        </li>
      </ul>
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
      {{ ready ? `立派 · ${name.trim()}` : blockLine }}
    </button>
  </div>
</template>

<script setup lang="ts">
  import { computed, ref } from 'vue'
  import { SECT_NAME_MAX, SECT_NAME_MIN, SECT_SKILLS } from '@/data/sect'
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

  const name = ref('')

  const cost = computed(() => foundCost(sect.rate))
  const realmOk = computed(() => canFound(player.major))
  const gateName = computed(() => REALMS[SECT_FOUND_MAJOR]?.name ?? '元婴')

  /** 每层三门的名字:五层各一行,让人一眼看清「门里有什么」 */
  const rows = computed<[number, string[]][]>(() => {
    const map = new Map<number, string[]>()
    for (const def of SECT_SKILLS) {
      const list = map.get(def.row) ?? []
      list.push(def.name)
      map.set(def.row, list)
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0])
  })

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
    void sect.found(name.value)
  }
</script>
