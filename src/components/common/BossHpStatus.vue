<template>
  <!--
    首领战况:血条 + 余血 + 战至第几轮。
    副本战报是逐行文字,心魔战还会把后六轮折成「……」,读完也判不出有没有斩杀;
    这一块把服务端结出的战况直接摆出来,输赢不必再从字缝里猜。
  -->
  <div class="mt-2 rounded border border-ink/15 px-2 py-1.5">
    <div class="flex items-baseline justify-between gap-2">
      <span class="min-w-0 truncate font-kai text-[12px] tracking-wide text-ink">{{ status.name }}</span>
      <span class="shrink-0 text-[11px] tabular" :class="status.killed ? 'text-jade' : 'text-cinnabar'">
        {{ bossBadgeText(status) }}
      </span>
    </div>
    <!-- 血条只作图形,读数由下面两行文字承担(不给屏读器多加一层无意义节点) -->
    <div class="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-ink/10" aria-hidden="true">
      <div
        class="h-full rounded-full transition-all duration-500"
        :class="status.killed ? 'bg-ink/20' : 'bg-cinnabar/80'"
        :style="{ width: bossBarWidth(status) + '%' }"
      />
    </div>
    <div class="mt-1 flex items-baseline justify-between gap-2 text-[10px] text-ink-faint">
      <span class="min-w-0 truncate tabular">{{ bossHpText(status) }}</span>
      <span v-if="status.roundText !== ''" class="shrink-0 tabular">{{ status.roundText }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { bossBadgeText, bossBarWidth, bossHpText, type BossStatusView } from '@/ui/bossStatus'

  defineProps<{ status: BossStatusView }>()
</script>
