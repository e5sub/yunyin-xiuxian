<template>
  <template v-if="inst && quote">
    <div class="ink-divider my-3" />
    <p class="flex items-center justify-between text-[12px] text-ink-faint">
      <span>强化 +{{ inst.level + 1 }} / 上限 {{ equipLevelCap() }}</span>
      <span class="tabular" :class="quote.safe ? 'text-jade' : 'text-gold-ink'">成功率 {{ pct(quote.rate) }}</span>
    </p>
    <p class="mt-1 text-[11px] leading-relaxed tabular text-ink-soft">
      器灵尘×{{ quote.dust }} · 修为 {{ formatGN(quote.exp) }} · 灵石 {{ formatGN(quote.stone) }}
    </p>
    <p class="mt-1 text-[11px] tabular text-azure">{{ equipNextLevelText(inst.level) }}</p>
    <!-- 保级点每 10 级一个:踩在上面失手也不掉级 -->
    <p class="mt-1 text-[10px] leading-relaxed" :class="quote.safe ? 'text-jade' : 'text-cinnabar'">
      {{ quote.safe ? '正处保级点 —— 失手不掉级' : `失手回落至 +${quote.failLevel}` }}
    </p>
    <p v-if="short" class="mt-1 text-[10px] leading-relaxed text-cinnabar tabular">
      <template v-if="gap.dust > 0">器灵尘尚差 {{ gap.dust }}</template>
      <template v-if="gap.dust > 0 && gap.exp.m > 0"> · </template>
      <template v-if="gap.exp.m > 0">修为尚差 {{ formatGN(gap.exp) }}</template>
      <template v-if="(gap.dust > 0 || gap.exp.m > 0) && gap.stone.m > 0"> · </template>
      <template v-if="gap.stone.m > 0">灵石尚差 {{ formatGN(gap.stone) }}</template>
    </p>
    <!--
      连升二步确认与分解/散去同款。
      flex-wrap + 文本保底宽不可去:否则窄屏 flex-1 文本被 shrink-0 钮压成 0 宽竖排。
    -->
    <div v-if="batchPlan.attempts > 0" class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-md border border-ink/10 bg-paper-deep/50 px-2.5 py-2">
      <template v-if="batchConfirm !== inst.uid">
        <div class="min-w-[5rem] flex-1">
          <p class="text-[10px] text-ink-faint">
            可连试 <span class="font-kai text-[12px] text-cinnabar">{{ batchPlan.attempts }}</span> 次(每次都可能失手)
          </p>
          <p class="mt-0.5 text-[9px] text-ink-faint tabular">
            全成需 器灵尘×{{ batchPlan.dust }} · 修为 {{ formatGN(batchPlan.exp) }} · 灵石 {{ formatGN(batchPlan.stone) }}
          </p>
        </div>
        <button class="btn-ghost shrink-0 !px-3 !py-2 !text-[11px]" @click="batchConfirm = inst.uid">连 强</button>
      </template>
      <template v-else>
        <p class="min-w-[5rem] flex-1 text-[10px] leading-relaxed text-cinnabar">
          连试 {{ batchPlan.attempts }} 次,失手即停 · 器灵尘×{{ batchPlan.dust }} · 修为 {{ formatGN(batchPlan.exp) }}
        </p>
        <button class="btn-ghost shrink-0 !px-2.5 !py-2 !text-[11px]" @click="batchConfirm = null">再想想</button>
        <button class="btn-seal shrink-0 !px-2.5 !py-2 !text-[11px]" @click="runBatchUpgrade">连 强</button>
      </template>
    </div>
  </template>
</template>

<script setup lang="ts">
  import { computed, ref } from 'vue'
  import { useUiStore } from '@/stores/ui'
  import { useInventoryStore } from '@/stores/inventory'
  import { equipLevelCap, equipUpgradeQuote, upgradeBatchPlan, upgradeEquipmentBatch, upgradeShort, upgradeShortfall, type UpgradeBatchPlan } from '@/core/forge'
  import { formatGN } from '@/utils/format'
  import { gnZero } from '@/utils/gnum'
  import { equipNextLevelText } from '@/ui/equipText'

  /** 成本与预览全读 core/forge,不持第二本账;当前件取 ui.equipDetailUid,与宿主同一份 inst */
  const ui = useUiStore()
  const inventory = useInventoryStore()

  const inst = computed(() => (ui.equipDetailUid ? inventory.findItem(ui.equipDetailUid) : undefined))
  const quote = computed(() => (inst.value ? equipUpgradeQuote(inst.value.uid) : null))
  const short = computed(() => (quote.value ? upgradeShort(quote.value) : null))
  const gap = computed(() => (quote.value ? upgradeShortfall(quote.value) : { dust: 0, exp: gnZero(), stone: gnZero() }))
  /** 连强计划:预览与执行同一份;一次都试不起时 attempts=0,整块隐藏 */
  const batchPlan = computed<UpgradeBatchPlan>(() =>
    inst.value ? upgradeBatchPlan(inst.value.uid) : { attempts: 0, dust: 0, stone: gnZero(), exp: gnZero(), atCap: false }
  )
  /** 连强二步确认态:按 uid 记,换件即失效 */
  const batchConfirm = ref<string | null>(null)

  function pct(rate: number): string {
    return `${Math.round(rate * 100)}%`
  }

  function runBatchUpgrade(): void {
    if (!inst.value) return
    batchConfirm.value = null
    upgradeEquipmentBatch(inst.value.uid)
  }
</script>
