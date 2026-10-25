<template>
  <!-- 一键分解:勾选品质(记忆勾选)。纯手动批量动作 —— 与「智能收纳」的自动取舍互不干扰 -->
  <BaseModal :open="decomposeOpen" title="一键分解(手动)" @close="emit('close-decompose')">
    <p class="text-[11px] leading-relaxed text-ink-faint">
      勾选要化掉的品质,只管
      <span class="text-ink-soft">行囊里现存</span>
      之物;已佩戴与上锁的装备不受影响。这份勾选会留作下次,却只在
      <span class="text-ink-soft">下文「分 解」时作数</span>
      —— 历练中掉落的装备不在此列,去留另由「智能收纳」的尺度把持。
    </p>
    <div class="mt-2 space-y-1">
      <label
        v-for="row in decomposeRows"
        :key="row.rank"
        class="flex items-center gap-2.5 rounded-md px-2.5 py-1.5"
        :class="settings.decomposeRanks.includes(row.rank) ? 'bg-paper-deep/80' : ''"
      >
        <input
          type="checkbox"
          class="h-4 w-4 accent-cinnabar"
          :checked="settings.decomposeRanks.includes(row.rank)"
          @change="toggleRank(row.rank)"
        />
        <span class="font-kai text-[13px]" :style="{ color: row.color }">{{ row.name }}</span>
        <span class="ml-auto tabular text-[11px] text-ink-faint">
          现存 {{ row.count }} 件
          <template v-if="row.count > 0">· {{ row.text }}</template>
        </span>
      </label>
    </div>
    <p v-if="decomposeTotal > 0" class="mt-2 text-right text-[11px] text-cinnabar tabular">
      共 {{ decomposeTotal }} 件,入炉可化 {{ batchYieldText(decomposePlanned) }}
    </p>
    <template #footer>
      <button class="btn-seal w-full" :disabled="decomposeTotal === 0" @click="confirmDecompose">
        分 解{{ decomposeTotal > 0 ? `(${decomposeTotal} 件)` : '' }}
      </button>
    </template>
  </BaseModal>

  <!-- 智能收纳:独立的自动取舍策略 —— 与「一键分解」的手动动作井水不犯河水 -->
  <BaseModal :open="smartOpen" title="智能收纳(自动)" @close="emit('close-smart')">
    <p class="text-[11px] leading-relaxed text-ink-faint">
      开启后,新落之物在入行囊前先过一关:值得留的留下,无缘的一缕化尘;行囊已满且有无缘旧物时,新至的宝物会顶走包里最弱的一件,无可顶者便也化尘。
    </p>
    <!-- 状态一眼:策略一段话说清,不必把六个开关拼起来读 -->
    <div
      class="mt-2.5 rounded-md px-3 py-2 text-[10px] leading-relaxed"
      :class="settings.smartKeep.enabled ? 'bg-jade/8 text-jade' : 'bg-ink/4 text-ink-faint'"
    >
      {{ smartStatusLine }}
    </div>

    <p class="mb-1 mt-3 font-kai text-[11px] tracking-wider text-ink-soft">规则 · 门槛</p>
    <div class="rounded-md border border-ink/8 bg-paper-deep/40 px-2.5 py-1">
      <label class="flex items-center justify-between py-1.5">
        <span class="text-[13px] text-ink-soft">启用智能收纳</span>
        <input v-model="settings.smartKeep.enabled" type="checkbox" class="h-4 w-4 accent-cinnabar" />
      </label>
      <!-- 品质线:九档全列,从哪一档起珍 —— 不只灵品/玄品/地品三档可选 -->
      <div class="border-t border-ink/6 py-1.5">
        <p class="mb-1.5 text-[12px] text-ink-soft">品质线 · 自「{{ KEEP_QUALITY_CHOICES.find(q => q.rank === settings.smartKeep.minQuality)?.name ?? '灵品' }}」起珍藏</p>
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="q in KEEP_QUALITY_CHOICES"
            :key="q.rank"
            class="chip-ink !py-2 text-[10px]"
            :class="settings.smartKeep.minQuality === q.rank ? 'border-cinnabar text-cinnabar' : 'border-ink/25 text-ink-faint'"
            @click="settings.smartKeep.minQuality = q.rank"
          >
            {{ q.name }}
          </button>
        </div>
      </div>
      <!-- 阶级线:阶数到线的,须同时过品质线才留;与品质线「且」关系 -->
      <div class="border-t border-ink/6 py-1.5">
        <p class="mb-1.5 text-[12px] text-ink-soft">
          阶级线 ·
          {{ settings.smartKeep.keepMinTier > 0 ? `自 ${settings.smartKeep.keepMinTier} 阶起,双线皆满才留` : '不设(只看品质与识宝)' }}
        </p>
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="t in KEEP_TIER_CHOICES"
            :key="t"
            class="chip-ink !py-2 text-[10px]"
            :class="settings.smartKeep.keepMinTier === t ? 'border-cinnabar text-cinnabar' : 'border-ink/25 text-ink-faint'"
            @click="settings.smartKeep.keepMinTier = t"
          >
            {{ t === 0 ? '不设' : `${t} 阶` }}
          </button>
        </div>
      </div>
    </div>

    <!-- 识宝 · 单看品质不够:这四项认「值得」,不认「贵贱」 -->
    <p class="mb-1 mt-3 font-kai text-[11px] tracking-wider text-ink-soft">识宝 · 品质之外的值得</p>
    <div class="rounded-md border border-ink/8 bg-paper-deep/40 px-2.5 py-1">
      <label class="flex items-center justify-between py-1.5">
        <span class="text-[12px] text-ink-soft">主流派核心词条件</span>
        <input v-model="settings.smartKeep.keepCoreAffix" type="checkbox" class="h-4 w-4 accent-cinnabar" />
      </label>
      <label class="flex items-center justify-between py-1.5">
        <span class="text-[12px] text-ink-soft">组合技部件(副体系词条)</span>
        <input v-model="settings.smartKeep.keepComboPiece" type="checkbox" class="h-4 w-4 accent-cinnabar" />
      </label>
      <label class="flex items-center justify-between py-1.5">
        <span class="text-[12px] text-ink-soft">成套共鸣件(机制优先)</span>
        <input v-model="settings.smartKeep.keepSetPiece" type="checkbox" class="h-4 w-4 accent-cinnabar" />
      </label>
      <label class="flex items-center justify-between py-1.5">
        <span class="text-[12px] text-ink-soft">词条近满件</span>
        <input v-model="settings.smartKeep.keepPerfectRolls" type="checkbox" class="h-4 w-4 accent-cinnabar" />
      </label>
    </div>
    <p class="mt-1.5 text-[10px] leading-relaxed text-ink-faint">
      强化、重铸、转入过或带封存的件不动。
    </p>

    <!-- 划界 · 与「一键分解」互不读钩 -->
    <p class="mb-1 mt-3 font-kai text-[11px] tracking-wider text-ink-soft">与「一键分解」各归各帐</p>
    <p class="text-[10px] leading-relaxed text-ink-faint">
      「一键分解」只处置行囊里现存之物,须你亲手动;这里只判掉落之后的去留 ——
      两件事各归各管,调了这一头,那一头不受牵连。
    </p>
    <template #footer>
      <!--
        一键清理二步确认:整包报废,按一下不该就此了结。
        确认页直接列清单(预览与下手同一份名单)+ 入炉收益 —— 化的是什么,一目了然
      -->
      <template v-if="!cleanConfirm">
        <button
          class="btn-ghost w-full !text-[12px]"
          :class="cleanCount ? '' : 'opacity-45'"
          :disabled="cleanCount === 0"
          @click="cleanConfirm = true"
        >
          依此规则清理行囊{{ cleanCount ? `(无缘之物化尘 · ${cleanCount} 件)` : '(已无可清之缘)' }}
        </button>
      </template>
      <template v-else>
        <p class="mb-1 text-center text-[11px] text-cinnabar tabular">
          将化尘 {{ cleanCount }} 件,入炉可得 {{ batchYieldText(cleanYield) }}——此举不可逆
        </p>
        <div class="mb-2 max-h-36 overflow-y-auto rounded-md border border-ink/8 bg-paper-deep/40 px-2.5 py-1.5">
          <p
            v-for="t in cleanPreview.slice(0, SWEEP_PREVIEW_LIMIT)"
            :key="t.item.uid"
            class="flex items-baseline justify-between gap-2 py-1 text-[10px]"
          >
            <span class="min-w-0 truncate font-kai" :style="{ color: qualityDef(t.item.quality).color }">
              {{ equipmentTemplate(t.item.templateId)?.name ?? '旧物' }}
            </span>
            <span class="shrink-0 text-ink-faint tabular">{{ t.item.tier }} 阶 · {{ t.reason }}</span>
          </p>
          <p v-if="cleanPreview.length > SWEEP_PREVIEW_LIMIT" class="mt-0.5 border-t border-ink/6 pt-0.5 text-[9px] text-ink-faint">
            … 其余 {{ cleanPreview.length - SWEEP_PREVIEW_LIMIT }} 件从略
          </p>
          <p v-if="!cleanPreview.length" class="py-0.5 text-[10px] text-jade">此尺度下,行囊已无一缘可清</p>
        </div>
        <!-- 行囊若已满:榜首那件就是下一件新物的顶位对象,先把临头的事说破 -->
        <p v-if="bagFull && cleanPreview.length" class="mb-2 text-[9px] leading-relaxed text-ink-faint">
          行囊已满 —— 若无意外,下一件新宝会先顶走榜首「{{ firstSweepName }}」。
        </p>
        <div class="flex gap-2">
          <button class="btn-ghost flex-1 !text-[12px]" @click="cleanConfirm = false">再想想</button>
          <button class="btn-seal flex-1 !text-[12px]" @click="smartClean()">清理化尘</button>
        </div>
      </template>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
  import { computed, ref } from 'vue'
  import { QUALITIES, qualityDef } from '@/data/qualities'
  import { BAG_CAPACITY } from '@/data/constants'
  import { MAX_EQUIP_TIER, equipmentTemplate } from '@/data/equipment'
  import { useInventoryStore } from '@/stores/inventory'
  import { useSettingsStore } from '@/stores/settings'
  import { useUiStore } from '@/stores/ui'
  import { batchYieldText, type DecomposeBatch, decomposeBatch, decomposeByRanks, decomposePreview } from '@/core/forge'
  import { sweepTargets } from '@/core/smartKeep'
  import { salvageOf } from '@/core/salvage'
  import { add, gnZero } from '@/utils/gnum'
  import { decomposeEmptyToast, smartCleanToast } from '@/ui/inventoryText'
  import BaseModal from '@/components/common/BaseModal.vue'

  /**
   * 分解只认勾选档、须亲手动;收纳只判掉落后的去留,两者互不干扰。
   * 开关归宿主,此处只认 props、回传关闭。
   */
  defineProps<{ decomposeOpen: boolean; smartOpen: boolean }>()
  const emit = defineEmits<{ 'close-decompose': []; 'close-smart': [] }>()

  const inventory = useInventoryStore()
  const settings = useSettingsStore()
  const ui = useUiStore()

  /** 各品质档现存件数与返还,与服务同一套算法 */
  const decomposeRows = computed(() =>
    QUALITIES.map(q => {
      const got = decomposePreview([q.rank])
      return { rank: q.rank, name: q.name, color: q.color, count: got.count, text: batchYieldText(got) }
    })
  )

  const decomposeTotal = computed(() =>
    decomposeRows.value.filter(r => settings.decomposeRanks.includes(r.rank)).reduce((sum, r) => sum + r.count, 0)
  )

  const decomposePlanned = computed(() => decomposePreview(settings.decomposeRanks))

  function toggleRank(rank: number): void {
    const adding = !settings.decomposeRanks.includes(rank)
    settings.decomposeRanks = adding
      ? [...settings.decomposeRanks, rank].sort((a, b) => a - b)
      : settings.decomposeRanks.filter(r => r !== rank)
    // 勾选只标记,点「分 解」才销毁
  }

  function confirmDecompose(): void {
    // 总账 toast 由服务报,不逐件弹
    if (decomposeByRanks(settings.decomposeRanks) === 0) ui.toast(decomposeEmptyToast(), 'info')
    emit('close-decompose')
  }

  const KEEP_QUALITY_CHOICES = QUALITIES.map(q => ({ rank: q.rank, name: q.name }))
  /** 阶级自留线常用档:0 = 不设;顶格同源 MAX_EQUIP_TIER */
  const KEEP_TIER_CHOICES = [0, 8, 12, 16, 20, 24, 28, MAX_EQUIP_TIER]

  /** 清理预告清单条数上限,超出收成「另 N 件」 */
  const SWEEP_PREVIEW_LIMIT = 6

  /** 将化之件;预览与下手同一份名单 */
  const cleanPreview = computed(() => sweepTargets(inventory.bagItems))
  const cleanCount = computed(() => cleanPreview.value.length)
  /** 清理收益:纯算不化,与一键分解的 preview 同口径 */
  const cleanYield = computed<DecomposeBatch>(() => {
    const total: DecomposeBatch = { count: 0, dust: 0, stone: gnZero() }
    for (const t of cleanPreview.value) {
      const gain = salvageOf(t.item)
      total.count += 1
      total.dust += gain.dust
      total.stone = add(total.stone, gain.stone)
    }
    return total
  })
  /** 行囊是否已满:满时新宝会先顶走榜首那件无缘旧物 */
  const bagFull = computed(() => inventory.bagItems.length >= BAG_CAPACITY)
  /** 榜首件的名字(行囊满时,下一件新物的顶位对象) */
  const firstSweepName = computed(() => {
    const first = cleanPreview.value[0]
    return first ? (equipmentTemplate(first.item.templateId)?.name ?? '旧物') : ''
  })

  /**
   * 当前策略一句话:门槛 + 识宝命中 + 余者化尘。把六个开关拼成一句人话,
   * 玩家不必心读这页才知道「自动」到底会怎么做。
   */
  const smartStatusLine = computed(() => {
    const sk = settings.smartKeep
    if (!sk.enabled) return '未启用 —— 掉落照常入包,此间的尺度暂且不用'
    const keepName = KEEP_QUALITY_CHOICES.find(q => q.rank === sk.minQuality)?.name ?? '灵品'
    const tierLine = sk.keepMinTier > 0 ? `;且自 ${sk.keepMinTier} 阶起,双线皆满才留` : ''
    const tags = [
      sk.keepCoreAffix && '核心',
      sk.keepComboPiece && '组合',
      sk.keepSetPiece && '成套',
      sk.keepPerfectRolls && '近满'
    ].filter(Boolean)
    const grace = tags.length ? `;带${tags.join('或')}之器,一并留藏` : ''
    return `${keepName}以上尽数珍藏${tierLine}${grace};余者无缘,落地便化作器灵尘`
  })

  /** 清理确认态:按一次按钮先落在「再想想/清理化尘」上 */
  const cleanConfirm = ref(false)

  /**
   * 点下时现算名单(与确认页同源):sweepTargets 恰按 decomposeBatch 成功的「件在包且未锁」筛。
   * toast 报 decomposeBatch 实得,不报预览数。
   */
  function smartClean(): void {
    cleanConfirm.value = false
    const snapshot = sweepTargets(inventory.bagItems) // 与确认页同源,兜底再取一次
    const got = decomposeBatch(snapshot.map(t => t.item))
    // 有化尘 = 有得,归 success;一件都没化 = 中性播报,留 info(与一键换装同族口径)
    ui.toast(smartCleanToast(got.count, batchYieldText(got)), got.count > 0 ? 'success' : 'info')
    emit('close-smart')
  }
</script>
