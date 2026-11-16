<template>
  <div class="card-ink px-3 py-3">
    <div class="flex items-baseline justify-between gap-2">
      <span class="font-kai text-[12px] tracking-wider text-ink-soft">捐献</span>
      <span class="shrink-0 text-[10px] tabular" :class="left > 0 ? 'text-jade' : 'text-ink-faint'">
        今日 {{ left }}/{{ quota }} 次
      </span>
    </div>
    <p class="mt-1 text-[10px] leading-relaxed text-ink-faint">
      所捐之物当场入账:七成记个人贡献(修技能),三成入门派库(营建筑)。{{ vipLine }}
    </p>

    <div class="mt-2 space-y-2">
      <div v-for="d in SECT_DONATIONS" :key="d.kind" class="rounded-md border border-ink/10 bg-paper-deep/40 px-2.5 py-2">
        <div class="flex items-center gap-2">
          <span class="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-ink/5 text-ink-soft">
            <GameIcon :name="d.icon" :size="15" />
          </span>
          <div class="min-w-0 grow">
            <p class="font-kai text-[12px] text-ink">{{ d.name }}</p>
            <p class="mt-0.5 text-[10px] leading-snug text-ink-faint tabular">{{ amountLine(d.kind, d.amount) }}</p>
          </div>
          <div class="shrink-0 text-right">
            <p class="text-[10px] leading-none text-ink-faint">得贡献</p>
            <p class="mt-0.5 text-[13px] leading-none tabular text-gold-ink">{{ d.contribution }}</p>
          </div>
        </div>
        <button
          class="btn-ghost mt-2 w-full !py-1.5 !text-[12px]"
          :disabled="left <= 0 || !canAfford(d.kind, d.amount) || sect.pending"
          @click="go(d.kind)"
        >
          {{ left <= 0 ? '今日已尽' : canAfford(d.kind, d.amount) ? '捐 献' : '所捐不足' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import GameIcon from '@/components/common/GameIcon.vue'
  import { SECT_DONATIONS } from '@/data/sect'
  import type { SectDonateKind } from '@/data/sect'
  import { donationHerbGrade, donationQuota } from '@/core/sectRules'
  import { usePlayerStore } from '@/stores/player'
  import { useResourcesStore } from '@/stores/resources'
  import { useSectStore } from '@/stores/sect'
  import { useAuthStore } from '@/stores/auth'
  import { HERB_GRADE_SHORT } from '@/data/herbGrades'
  import { formatGN } from '@/utils/format'
  import { gn } from '@/utils/gnum'

  const auth = useAuthStore()
  const player = usePlayerStore()
  const resources = useResourcesStore()
  const sect = useSectStore()

  const quota = computed(() => donationQuota(auth.isVip))
  const left = computed(() => sect.donationsLeft)
  const grade = computed(() => donationHerbGrade(player.major))

  /** VIP 多两次:常驻玩家看到的是 3,别把 5 写成默认 */
  const vipLine = computed(() => (auth.isVip ? '月卡在身:每日五次。' : '月卡道友每日五次。'))

  function amountLine(kind: SectDonateKind, amount: number): string {
    if (kind === 'stone') return `灵石 ${formatGN(gn(amount))}`
    if (kind === 'ore') return `${amount} 玄铁`
    return `${amount} 株 · ${HERB_GRADE_SHORT[grade.value]}灵草`
  }

  function canAfford(kind: SectDonateKind, amount: number): boolean {
    if (kind === 'stone') return resources.hasStone(gn(amount))
    if (kind === 'ore') return resources.hasSmall('ore', amount)
    return resources.hasHerb(grade.value, amount)
  }

  function go(kind: SectDonateKind): void {
    void sect.donate(kind)
  }
</script>
