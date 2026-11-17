<template>
  <BaseModal :open="open" title="一键强化" aria-label="一键强化消耗一览" @close="emit('close')">
    <!--
      一键强化的消耗摊开页(1.73.0):原来「大额才展开总额」是行内两行字,
      玩家只知道总数,不知道钱花在哪 —— 队列按部位排、武器打头,一件 34 阶器
      一次就吃掉数百亿,钮上却只写「N 件 +1」。现在每次点都弹这一页:
      逐件列价、给累计,总额与余额前后摆在一起,看清了再落手。
    -->
    <p class="text-[10px] leading-relaxed text-ink-faint">
      身上已装备的按部位顺序各掷一次(+1);每一掷都可能失手,失手即停,实扣只会更少。
    </p>

    <!-- 总额与余额:三样料各一行,前面是现在有多少,后面是全成之后剩多少 -->
    <div class="card-ink mt-2 px-3 py-2.5">
      <p v-for="line in totalRows" :key="line.label" class="flex items-baseline justify-between gap-2 text-[11px] tabular">
        <span class="shrink-0 text-ink-soft">{{ line.label }}</span>
        <span class="min-w-0 text-right">
          <span class="text-ink-faint">{{ line.before }}</span>
          <span class="mx-1 text-ink-faint">→</span>
          <span :class="line.enough ? 'text-ink' : 'text-cinnabar'">{{ line.after }}</span>
        </span>
      </p>
    </div>

    <!-- 逐件价目:与下手同一把 equipSweepPlan,付得起才排进来 -->
    <ul v-if="rows.length" class="mt-2 space-y-1.5">
      <li v-for="(row, i) in rows" :key="row.slot" class="rounded-md bg-paper-deep/40 px-2.5 py-2">
        <p class="flex flex-wrap items-baseline gap-x-2">
          <span class="font-kai text-[12px] text-ink">{{ row.slotName }}</span>
          <span class="text-[10px] text-ink-faint">{{ row.tier }} 阶 · +{{ row.level }} → +{{ row.level + 1 }}</span>
          <span class="ml-auto shrink-0 text-[10px] tabular" :class="row.safe ? 'text-jade' : 'text-gold-ink'">成 {{ row.rate }}</span>
        </p>
        <p class="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-[11px] tabular text-ink-soft">
          <span>灵石 {{ formatGN(row.stone) }}</span>
          <span>尘×{{ row.dust }}</span>
          <span>修为 {{ formatGN(row.exp) }}</span>
          <!-- 到这一件为止的累计:让「排头吃掉九成」看得见,不用心算 -->
          <span v-if="i > 0" class="ml-auto text-[10px] text-ink-faint">累计灵石 {{ formatGN(row.cumStone) }}</span>
        </p>
        <p class="mt-0.5 text-[10px]" :class="row.safe ? 'text-jade' : 'text-cinnabar'">
          {{ row.safe ? '正处保级点 —— 失手不掉级' : `失手回落至 +${row.failLevel}` }}
        </p>
      </li>
    </ul>
    <!--
      弹窗不再一点即关(1.74.0):强化成功一件,队列就少一件,这一段跟着换话。
      「皆已满级 / 未装备」与「料不够」是两件不同的事,原先共用一句「付不起任何一件」。
    -->
    <p v-else class="mt-2 text-[11px] text-ink-faint">
      {{ plan.short !== null ? '料不够上任何一件 —— 见下方缺料。' : '身上已无可强化之物(皆已满级,或未装备)。' }}
    </p>

    <!-- 计划外的两句话:满级跳过的与缺料停手的 -->
    <p v-if="plan.capped > 0" class="mt-1.5 text-[10px] text-ink-faint">另有 {{ plan.capped }} 件已至强化上限,本轮跳过。</p>
    <p v-if="plan.stoppedAt !== null && plan.short" class="mt-1 text-[10px] leading-relaxed text-cinnabar tabular">
      料只够上列 {{ rows.length }} 件 —— 停在{{ EQUIP_SLOT_NAMES[plan.stoppedAt] }}:{{ upgradeShortToast(plan.short) }}。
    </p>

    <template #footer>
      <div class="flex gap-2">
        <button class="btn-ghost flex-1 !py-2 !text-[12px]" @click="emit('close')">再想想</button>
        <button
          class="btn-seal flex-1 !py-2 !text-[12px]"
          :disabled="busy || plan.queue.length === 0"
          :title="busy ? '正在结算' : plan.queue.length === 0 ? '无可强化件' : undefined"
          @click="emit('confirm')"
        >
          确认强化
        </button>
      </div>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import BaseModal from '@/components/common/BaseModal.vue'
  import { equipSweepPlan, equipUpgradeQuote, type EquipSweepPlan } from '@/core/forge'
  import { EQUIP_SLOT_NAMES } from '@/data/equipment'
  import { upgradeShortToast } from '@/ui/forgeText'
  import { settling } from '@/core/settleQueue'
  import { useInventoryStore } from '@/stores/inventory'
  import { useResourcesStore } from '@/stores/resources'
  import { usePlayerStore } from '@/stores/player'
  import { formatGN } from '@/utils/format'
  import { sub } from '@/utils/gnum'
  import type { GNum } from '@/types'

  defineProps<{ open: boolean }>()
  const emit = defineEmits<{ close: []; confirm: [] }>()

  const inventory = useInventoryStore()
  const resources = useResourcesStore()
  const player = usePlayerStore()

  /** 结算在途时禁掉「确认强化」:一键强化一次就是全身的价,双发等于双扣(1.74.0) */
  const busy = computed(() => settling.value > 0)

  /** 与下手同一份计划:预览即执行,不会「弹窗一套、扣款另一套」 */
  const plan = computed<EquipSweepPlan>(() => equipSweepPlan())

  interface SweepRow {
    slot: string
    slotName: string
    tier: number
    level: number
    dust: number
    stone: GNum
    exp: GNum
    cumStone: GNum
    rate: string
    failLevel: number
    safe: boolean
  }

  /** 逐件价目:按队列顺序,附到该件为止的灵石累计 */
  const rows = computed<SweepRow[]>(() => {
    const out: SweepRow[] = []
    let cum = plan.value.stone
    for (const slot of plan.value.queue) {
      const uid = inventory.equipped[slot]
      const inst = uid ? inventory.findItem(uid) : undefined
      if (!inst) continue
      const q = equipUpgradeQuote(inst.uid)
      if (!q) continue
      out.push({
        slot,
        slotName: EQUIP_SLOT_NAMES[slot],
        tier: inst.tier,
        level: inst.level,
        dust: q.dust,
        stone: q.stone,
        exp: q.exp,
        cumStone: cum,
        rate: `${Math.round(q.rate * 100)}%`,
        failLevel: q.failLevel,
        safe: q.safe
      })
      cum = sub(cum, q.stone)
    }
    return out
  })

  /** 三样料的「现有 → 全成后」:负数不会出现 —— 计划只排付得起的件 */
  const totalRows = computed(() => {
    const p = plan.value
    return [
      {
        label: '灵石',
        before: formatGN(resources.spiritStone),
        after: formatGN(sub(resources.spiritStone, p.stone)),
        enough: true
      },
      {
        label: '器灵尘',
        before: `${resources.dust}`,
        after: `${resources.dust - p.dust}`,
        enough: resources.dust >= p.dust
      },
      {
        label: '修为',
        before: formatGN(player.exp),
        after: formatGN(sub(player.exp, p.exp)),
        enough: true
      }
    ]
  })

  defineOptions({ name: 'SweepConfirmDialog' })
</script>
