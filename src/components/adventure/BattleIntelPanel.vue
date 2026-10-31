<template>
  <!--
    战斗情报面板:战后统计行 / 本战所得 / 此物所知 / 战斗分析,只此一处消费,自取 store。
    回放引擎与敌我半卡留在宿主 CombatPanel:搬来会让回放与情报各读一份状态。
  -->
  <!-- 战斗后统计 + 情报入口 -->
  <p v-if="battleSummary" class="mt-2 flex items-center justify-center gap-2 text-center text-[10px] text-ink-faint tabular">
    {{ battleSummary }}
    <!-- 触达区 ≥28px(layout-check 判据):min-h 撑高,负外边距抵消,视觉密度不变;
         文案旁的小动作一律带一圈细边框(ring 不占位,不挤动这一行的换行) -->
    <button
      v-if="lore"
      class="-my-2 inline-flex min-h-[28px] items-center rounded px-1.5 text-violet-ink ring-1 ring-inset ring-violet-ink/30 active:opacity-60"
      @click="openLore"
    >
      此物所知 »
    </button>
    <button
      v-if="analysis"
      class="-my-2 inline-flex min-h-[28px] items-center rounded px-1.5 text-azure ring-1 ring-inset ring-azure/30 active:opacity-60"
      @click="openAnalysis"
    >
      战斗分析 »
    </button>
  </p>
  <!-- 本战拾获明细 -->
  <p v-if="battleLoot.length" class="mt-1 text-center text-[10px] leading-relaxed text-ink-faint">
    <span class="text-gold-ink">本战所得</span>
    {{ battleLoot.join(' · ') }}
  </p>

  <BaseModal :open="showLore" title="此物所知" @close="showLore = false">
    <div v-if="pinnedLore" class="rounded-md bg-ink/4 px-3 py-2.5">
      <p class="flex items-center gap-2">
        <span class="font-kai text-[12px] tracking-wider text-ink">{{ pinned?.enemyName }}</span>
        <span class="chip-ink border-violet-ink/50 text-[9px] text-violet-ink">{{ pinnedLore.stageName }}</span>
        <span v-if="pinnedLore.boosted" class="text-[10px] text-gold-ink">宿慧照见</span>
      </p>
      <p v-if="pinnedLore.elementName || pinnedLore.frame.length" class="mt-1 text-[11px] text-ink-soft">
        <span v-if="pinnedLore.elementName" class="mr-1.5 text-azure">{{ pinnedLore.elementName }}属</span>
        {{ pinnedLore.frame.join(' · ') }}
      </p>
      <p v-for="s in pinnedLore.skills" :key="s.name" class="mt-1 text-[11px] leading-relaxed text-ink-soft">
        ·
        <span class="text-ink">{{ s.name }}</span>
        ——{{ s.note }}
      </p>
      <p v-for="ph in pinnedLore.phases" :key="ph.at" class="mt-1 text-[11px] leading-relaxed text-cinnabar">
        · {{ ph.at }}时{{ ph.label }}
      </p>
      <p v-if="pinnedLore.archetype" class="mt-1.5 text-[11px] leading-relaxed text-gold-ink">
        <span v-if="pinnedLore.archetypeLabel" class="mr-1 rounded bg-gold-ink/10 px-1 py-0.5 text-[10px]">
          {{ pinnedLore.archetypeLabel }}
        </span>
        {{ pinnedLore.archetype }}
      </p>
      <!--
        记数规则须与 loreService 的 noteEnemy 同一张门槛表:胜一记、败三记、首领倍算。
        「下一层」以有效层为基准(宿慧照见会抬一档);有效层到顶时不报下一层,只剩计数。
      -->
      <p
        v-if="pinnedLore.progress && pinnedLore.progress.remain > 0"
        class="mt-1.5 text-[10px] leading-relaxed text-ink-faint tabular"
      >
        照面 {{ pinnedLore.progress.seen }} 记 · 再攒
        <span class="text-violet-ink">{{ pinnedLore.progress.remain }}</span> 记
        <template v-if="pinnedLore.progress.nextName">可窥「{{ pinnedLore.progress.nextName }}」</template>
        <span class="text-ink-faint">
          (胜一记 · 败计三<template v-if="pinnedLore.progress.isBoss"> · 首领倍算</template>)
        </span>
      </p>
    </div>
  </BaseModal>

  <BaseModal :open="showAnalysis" title="战斗分析" @close="showAnalysis = false">
    <div v-if="pinnedAnalysis" class="rounded-md bg-ink/4 px-3 py-2.5">
      <!-- 分析题首;与「此物所知」各用一套标题 -->
      <p class="flex items-baseline gap-1.5">
        <span
          class="h-3 w-1 shrink-0 self-center rounded-sm"
          :class="pinned?.result.win ? 'bg-jade' : 'bg-cinnabar'"
          aria-hidden="true"
        ></span>
        <span class="font-kai text-[12px] tracking-wider" :class="pinned?.result.win ? 'text-jade' : 'text-cinnabar'">
          {{ pinnedAnalysis.headline }}
        </span>
        <span class="chip-ink border-ink/15 text-[9px]" :class="pinned?.result.win ? 'text-jade' : 'text-cinnabar'">
          {{ pinned?.result.win ? '胜因' : '败因' }}
        </span>
      </p>
      <ul v-if="pinnedAnalysis.findings.length" class="mt-1.5 space-y-1">
        <li v-for="(f, i) in pinnedAnalysis.findings" :key="i" class="flex gap-1.5 text-[11px] leading-relaxed text-ink-soft">
          <span class="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-ink/30" aria-hidden="true"></span>
          <span>{{ f.text }}</span>
        </li>
      </ul>
      <!-- 借力方向:理由直接显示,不收进 :title(触屏无 hover) -->
      <div
        v-if="pinnedAnalysis.directions.length"
        class="mt-2 rounded-md border border-violet-ink/15 bg-violet-ink/5 px-2.5 py-2"
      >
        <p class="text-[10px] tracking-wide text-ink-faint">借力方向</p>
        <ul class="mt-1 flex flex-col gap-1">
          <li v-for="d in pinnedAnalysis.directions" :key="d.styleName" class="flex flex-col">
            <span class="text-[11px] text-violet-ink">{{ d.styleName }}</span>
            <span class="text-[10px] leading-relaxed text-ink-faint">{{ d.reason }}</span>
          </li>
        </ul>
      </div>
      <!-- 硬核数据:标签定宽不换行,数值占余宽(窄屏不互踩) -->
      <div v-if="pinnedAnalysis.dataRows.length" class="mt-2 border-t border-ink/10 pt-1.5">
        <div v-if="analysisSections.setup.length">
          <p class="text-[10px] tracking-wide text-ink-faint">战局定数</p>
          <div class="mt-0.5 space-y-0.5">
            <p v-for="row in analysisSections.setup" :key="row.label" class="flex items-baseline gap-3 text-[10px] tabular">
              <span class="min-w-[4.5rem] shrink-0 whitespace-nowrap text-ink-faint">{{ row.label }}</span>
              <span class="min-w-0 flex-1 text-right text-ink-soft">{{ row.value }}</span>
            </p>
          </div>
        </div>
        <div v-if="analysisSections.account.length" class="mt-1.5">
          <p class="text-[10px] tracking-wide text-ink-faint">战时账目</p>
          <div class="mt-0.5 space-y-0.5">
            <p v-for="row in analysisSections.account" :key="row.label" class="flex items-baseline gap-3 text-[10px] tabular">
              <span class="min-w-[4.5rem] shrink-0 whitespace-nowrap text-ink-faint">{{ row.label }}</span>
              <span class="min-w-0 flex-1 text-right text-ink-soft">{{ row.value }}</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  </BaseModal>
</template>

<script setup lang="ts">
  import { computed, ref, watch } from 'vue'
  import { useAdventureStore, type LastBattleView } from '@/stores/adventure'
  import { usePlayerStore } from '@/stores/player'
  import { detectBuild } from '@/core/buildDetect'
  import { analyzeBattle, type BattleAnalysis } from '@/core/battleAnalysis'
  import { playSfx } from '@/core/audio'
  import { enemyLoreView, type EnemyLoreView } from '@/ui/enemyLore'
  import BaseModal from '@/components/common/BaseModal.vue'

  const adventure = useAdventureStore()
  const player = usePlayerStore()

  const battle = computed(() => adventure.lastBattle)

  /** 本战拾获明细;败战/旧存档无此栏 → 空数组 */
  const battleLoot = computed(() => battle.value?.loot ?? [])

  /** 此物所知:情报深浅由认知层决定 */
  function loreOf(b: LastBattleView | null): EnemyLoreView | null {
    return b?.enemyId ? enemyLoreView(b.enemyId) : null
  }

  function analysisOf(b: LastBattleView | null): BattleAnalysis | null {
    if (!b) return null
    const build = detectBuild(player.finalStats.mods)
    return analyzeBattle(b.result, build?.style.id ?? null)
  }

  const battleSummary = computed(() => {
    const b = battle.value
    if (!b) return null
    const r = b.result
    const first = r.firstMove ? (r.firstMove.playerFirst ? ' · 抢先' : ' · 被抢先') : ''
    return `此战 ${r.rounds} 回合 · 战后气血 ${Math.round(r.playerHpPct * 100)}% · ${r.win ? '胜' : '负'}${first}`
  })

  // ---- 此物所知 / 战斗分析 ----
  // 入口看最新一战;弹窗内容取打开那一刻的快照:新战约每 12 秒落地,认知计数与增益也会变,开着不换内容
  const showLore = ref(false)
  const showAnalysis = ref(false)
  const pinned = ref<LastBattleView | null>(null)
  const lore = computed(() => loreOf(battle.value))
  const analysis = computed(() => analysisOf(battle.value))
  const pinnedLore = ref<EnemyLoreView | null>(null)
  const pinnedAnalysis = ref<BattleAnalysis | null>(null)

  function openLore(): void {
    pinned.value = battle.value
    pinnedLore.value = loreOf(battle.value)
    showLore.value = true
  }

  function openAnalysis(): void {
    pinned.value = battle.value
    pinnedAnalysis.value = analysisOf(battle.value)
    showAnalysis.value = true
  }

  /** 数据行分两节:战局定数(先手 / 敌之加成)与战时账目(其余);两个标签须与 battleAnalysis 里的字符串一致 */
  const analysisSections = computed(() => {
    const a = pinnedAnalysis.value
    if (!a) return { setup: [], account: [] }
    const SETUP_LABELS = new Set(['先手', '敌之加成'])
    return {
      setup: a.dataRows.filter(r => SETUP_LABELS.has(r.label)),
      account: a.dataRows.filter(r => !SETUP_LABELS.has(r.label))
    }
  })

  // 按胜负播战果音
  watch(
    () => battle.value?.at,
    () => {
      if (battle.value) playSfx(battle.value.result.win ? 'win' : 'lose')
    }
  )

</script>
