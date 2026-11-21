<template>
  <!-- 凡境册元婴起(灵石),天界册真仙起(道源) -->
  <section v-if="unlocked" class="card-ink px-4 py-3">
    <!-- 换行放宽:200% 缩放下「秘境」+ 门类芯片 + 层数挤不进一行,不换行会顶出右缘 -->
    <p class="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span class="font-kai text-[14px] tracking-[0.2em] text-ink">秘境</span>
      <span class="chip-ink !text-[9px]">{{ gate === 'celestial' ? '天界秘境' : '凡境秘境' }} · {{ cnNumber(SECRET_LAYERS) }}层 · 出则散</span>
      <span v-if="state" class="ml-auto flex items-center gap-1.5 text-[10px] tabular text-gold-ink">
        <!--
          层数刻度:要不要再入一层,取决于「还差几层见底」(见 ui/realmProgress)。
          格数随 SECRET_LAYERS 变,不是写死的三格。
        -->
        <span
          class="realm-layer-pips"
          :class="{ 'realm-layer-pips--deepest': progress.deepest }"
          role="img"
          :aria-label="`第 ${progress.layer}/${progress.layers} 层`"
        >
          <i v-for="(on, i) in realmLayerPips(progress)" :key="i" :class="{ on }" />
        </span>
        第 {{ progress.layer }}/{{ progress.layers }} 层
      </span>
    </p>

    <!-- 在境中 -->
    <template v-if="state">
      <p class="mt-1.5 text-[11px] leading-relaxed text-ink-soft">
        {{ def?.name }} · {{ def?.desc }}
      </p>
      <p class="mt-1 text-[10px] leading-relaxed text-violet-ink">此地规则:{{ secretRuleTexts(state).join(' · ') }}</p>
      <!-- 通关宝藏随行印着:逐层灵石灵草已见战利列表,这句只补「探尽那一刻还有什么」 -->
      <p class="mt-1 text-[10px] leading-relaxed text-gold-ink">通关宝藏:装备一件 · 悟道点 +3</p>
      <!-- 败场刻度:这是**剩余**而不是已得 —— 实心越少越危险,故与层数反过来 -->
      <p v-if="state.losses > 0" class="mt-0.5 flex items-center gap-1.5 text-[10px] leading-relaxed tabular text-cinnabar">
        <span
          class="realm-life-pips"
          :class="{ 'realm-life-pips--none': progress.livesLeft === 0 }"
          role="img"
          :aria-label="`还能败 ${progress.livesLeft} 场`"
        >
          <i v-for="(on, i) in realmLifePips(progress)" :key="i" :class="{ on }" />
        </span>
        已败 {{ state.losses }}/{{ SECRET_MAX_LOSSES }} 场 · 再败 {{ progress.livesLeft }} 场逐出
      </p>
      <p v-if="state.spoils.length" class="mt-1 max-h-24 overflow-y-auto text-[10px] leading-relaxed text-ink-faint">
        <span v-for="(s, i) in state.spoils" :key="i" class="block">· {{ s }}</span>
      </p>
      <!--
        战报(1.79.14):逐行揭示本层战况,播完才放开「再入一层」——
        连点不再跳战,层赏的经济 op 也借这段等待自然错开 300ms 限速。
      -->
      <div
        v-if="reportTotal > 0"
        class="mt-1.5 rounded-md bg-paper-deep/50 px-2.5 py-1.5"
        :class="reportWin ? 'text-jade' : 'text-cinnabar'"
        aria-live="polite"
      >
        <p v-for="(l, i) in reportShownLines" :key="i" class="block text-[10px] leading-relaxed">{{ l }}</p>
      </div>
      <div class="mt-2 grid grid-cols-2 gap-2">
        <button
          class="btn-seal w-full !py-1.5 !text-[12px]"
          :disabled="fighting || reporting"
          :title="fighting ? '交手中' : reporting ? '战报未完' : undefined"
          @click="fight"
        >
          再 入 一 层
        </button>
        <button class="btn-ghost w-full !py-1.5 !text-[12px]" @click="abandonRealm()">出 秘 境</button>
      </div>
    </template>

    <!-- 未入 -->
    <template v-else>
      <p v-if="elsewhere" class="mt-1 text-[10px] leading-relaxed text-ink-faint">
        身在「{{ elsewhere.name }}」
      </p>
      <div v-else class="mt-2 space-y-1.5">
        <!--
          禁用态不压整块透明度:那会把正文一起压到 1.74~3.02:1(实测),
          而卡片里那句「尚差 N 灵石」正是拒因本身。改为只换底色,字色不动。
        -->
        <!--
          可访问名 = 形制读数 + 入场代价 + 拒因。
          原先只有 `realmMark(r).label`(秘境名 · 回血档 · 战利倍率):置灰时屏幕上明明写着
          「灵石尚差 N」,读屏却只念得到形制读数,听不出为什么进不去;而卡面左侧的
          「灵石 4.468亿」同样没有进名字 —— 要付多少钱,读屏用户听不到。
          全仓的既有做法是「拒因走 aria-label / title」(见 EquipmentDetailDialog 的强 化钮),
          这里补齐同一条,代价一并带上。拼法收在 ui/realmMark.realmEntryLabel,可单测。

          一行里读的每一格都是 realmRow 预先算好的字段:模板不再对同一处反复调用
          realmMark / canPay / entryBlockText / entryCostText(原先合计十二次)。
        -->
        <button
          v-for="row in list"
          :key="row.def.id"
          class="w-full rounded-md bg-paper-deep/60 px-3 py-2 text-left active:scale-98 disabled:cursor-not-allowed disabled:bg-ink/4"
          :class="{ 'realm-top-gain': row.topGain }"
          :disabled="!row.payable"
          :aria-label="row.label"
          :title="row.block ?? undefined"
          @click="enter(row.def.id)"
        >
          <span class="flex items-baseline gap-2">
            <span class="font-kai text-[13px] text-ink">{{ row.def.name }}</span>
            <span class="text-[10px] tabular" :class="row.payable ? 'text-ink-faint' : 'text-cinnabar'">
              {{ row.cost }}
            </span>
            <span class="ml-auto text-[10px] text-azure">入 境 →</span>
          </span>
          <span v-if="row.block" class="mt-0.5 block text-[10px] tabular text-cinnabar">
            {{ row.block }}
          </span>
          <!-- 险利双轴:上一轴有多伤、下一轴值不值。两轴共用五处秘境的最小与最大,可横向比 -->
          <span class="mt-1 flex items-center gap-1.5">
            <span class="w-5 shrink-0 text-[9px] leading-none text-jade">回血</span>
            <span class="realm-axes min-w-0 flex-1" aria-hidden="true">
              <span class="realm-axis realm-axis--heal" :style="{ '--axis-pos': row.healPct }" />
              <span class="realm-axis realm-axis--gain" :style="{ '--axis-pos': row.gainPct }" />
            </span>
            <span class="w-5 shrink-0 text-right text-[9px] leading-none text-gold-ink">战利</span>
          </span>
          <span class="mt-0.5 block text-[10px] leading-relaxed text-gold-ink">{{ row.reward }}</span>
          <span class="mt-0.5 block text-[10px] leading-relaxed text-ink-faint">{{ row.def.desc }}</span>
        </button>
        <p v-if="list.length === 0" class="empty-note text-center text-[11px] text-ink-faint">
          暂无秘境
        </p>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
  import { computed, onUnmounted, ref } from 'vue'
  import { usePlayerStore } from '@/stores/player'
  import { useEndgameStore } from '@/stores/endgame'
  import { useUiStore } from '@/stores/ui'
  import { secretRealmDef, type SecretRealmDef } from '@/data/secretRealms'
  import { isTopGain, realmEntryLabel, realmMark } from '@/ui/realmMark'
  import { realmLayerPips, realmLifePips, realmProgress, SECRET_MAX_LOSSES } from '@/ui/realmProgress'
  import { cnNumber } from '@/utils/format'
  import {
    SECRET_LAYERS,
    abandonRealm,
    availableRealms,
    currentRealm,
    enterSecretRealm,
    entryCostText,
    entryShortfallOf,
    fightSecretLayer,
    realmUnlock,
    secretRewardText,
    secretRuleTexts,
    tierOfMajor
  } from '@/core/secretRealm'
  import { endgameBusy } from '@/core/endgameActivity'
  import { useAdventureStore } from '@/stores/adventure'

  const player = usePlayerStore()
  const endgame = useEndgameStore()
  const ui = useUiStore()

  const props = withDefaults(defineProps<{ gate?: 'mortal' | 'celestial' }>(), { gate: 'mortal' })

  const unlocked = computed(() => realmUnlock(props.gate))
  /** 秘境进度形制:层数与剩余败场(见 ui/realmProgress) */
  const progress = computed(() => realmProgress(state.value?.layer ?? 0, state.value?.losses ?? 0))

  /** 在境中(仅认本册):`currentRealm` 全局单份不分册,须按 gate 过滤,与 `availableRealms` 同口径 */
  const state = computed(() => {
    const s = currentRealm()
    if (!s) return null
    return secretRealmDef(s.realmId)?.gate === props.gate ? s : null
  })
  /** 身在另一册的境中:本册卡不摆入口,只报所在 */
  const elsewhere = computed(() => {
    const s = currentRealm()
    if (!s) return null
    const d = secretRealmDef(s.realmId)
    return d && d.gate !== props.gate ? d : null
  })
  const def = computed<SecretRealmDef | undefined>(() => (state.value ? secretRealmDef(state.value.realmId) : undefined))
  const busy = computed(() => endgameBusy(endgame.worldRun, player.secretRealm, useAdventureStore().session))
  /** 交手中:终层签发要一次网络往返,期间连点会重复结算 */
  const fighting = ref(false)

  /*
   * 战报逐行揭示(1.79.14):fightSecretLayer 的 lines 在卡面逐行亮出,
   * 播完(reporting=false)才允许点下一层 —— 用户口径「战报结束后才允许点进入下一层」。
   * 定时器随组件卸载清掉,不留悬挂回调。
   */
  const REPORT_LINE_MS = 650
  const reportLines = ref<readonly string[]>([])
  const reportWin = ref(true)
  const reportShownCount = ref(0)
  let reportTimer: ReturnType<typeof setTimeout> | null = null
  const reportTotal = computed(() => reportLines.value.length)
  const reportShownLines = computed(() => reportLines.value.slice(0, reportShownCount.value))
  const reporting = computed(() => reportShownCount.value < reportTotal.value)

  function clearReportTimer(): void {
    if (reportTimer !== null) {
      clearTimeout(reportTimer)
      reportTimer = null
    }
  }

  function showReport(lines: readonly string[], win: boolean): void {
    clearReportTimer()
    reportLines.value = lines
    reportWin.value = win
    reportShownCount.value = 0
    if (lines.length === 0) return
    const step = (): void => {
      reportShownCount.value++
      if (reportShownCount.value < reportLines.value.length) reportTimer = setTimeout(step, REPORT_LINE_MS)
      else reportTimer = null
    }
    reportTimer = setTimeout(step, REPORT_LINE_MS)
  }

  onUnmounted(clearReportTimer)

  /**
   * 一处秘境的一整行事实,一次算齐。
   *
   * 原先模板对同一处要算:realmMark 五次(每次都去遍历 SECRET_REALMS 求两级端点)、
   * canPay 两次、entryBlockText 三次、entryCostText 两次 —— 每一处都是重算,
   * 而模板里读不出「这几处说的是同一处」。
   * 现按「一次算齐、模板只读字段」的既有做法(见 MortalWorldView 的 places)收进来。
   *
   * @param r 这一处秘境
   */
  function realmRow(r: SecretRealmDef) {
    const mark = realmMark(r)
    const short = entryShortfallOf(r, player.major)
    const block = busy.value ? busy.value.reason : (short?.reason ?? null)
    const cost = entryCostText(r, player.major)
    const payable = block === null
    return {
      def: r,
      mark,
      cost,
      block,
      payable,
      topGain: isTopGain(mark),
      label: realmEntryLabel(mark, cost, block),
      healPct: `${mark.heal * 100}%`,
      gainPct: `${mark.gain * 100}%`,
      /** 通关全额预估(满胜口径,见 core/secretRealm.secretRewardText) */
      reward: secretRewardText(r.rewardMult, tierOfMajor(player.major), player.major)
    }
  }

  const list = computed(() => availableRealms(props.gate).map(realmRow))

  function enter(id: string): void {
    const out = enterSecretRealm(id)
    if (!out.ok) {
      ui.toast(out.reason ?? '无法进入', 'warn')
      return
    }
    ui.toast('已入秘境', 'info')
  }

  async function fight(): Promise<void> {
    if (fighting.value || reporting.value) return
    fighting.value = true
    try {
      const r = await fightSecretLayer()
      if (!r) return
      showReport(r.lines, r.win)
      // 合并为单条多行 toast:逐条 push 会被 toast 上限 5 挤掉前面的行
      // 胜归 success(与全库「有得有获」同级),败归 warn
      if (r.lines.length) ui.toast(r.lines.join('\n'), r.win ? 'success' : 'warn')
    } finally {
      fighting.value = false
    }
  }
</script>
