<template>
  <!-- 模式选择 + 战斗前预览 -->
  <BaseModal :open="region !== null" :title="region?.name ?? ''" @close="emit('close')">
    <!-- 适配预览 -->
    <div v-if="preview" class="mb-3 rounded-md bg-ink/4 px-3 py-2.5">
      <template v-if="preview.mine && currentBuild">
        <p class="flex items-center justify-between text-[12px]">
          <span class="text-ink-soft">
            当前构筑:
            <span class="font-kai text-ink">{{ currentBuild.displayName }}</span>
          </span>
          <span class="tabular text-gold-ink">{{ starsText(preview.mine.stars) }}</span>
        </p>
        <p v-for="(r, i) in preview.mine.reasons" :key="i" class="mt-0.5 text-[10px] text-ink-faint">{{ r }}</p>
      </template>
      <p v-else class="text-[11px] text-ink-faint">尚未成流派,此地对各路数一视同仁。</p>
      <div class="ink-divider my-2" />
      <p class="text-[10px] text-ink-faint">此地与你的路数合不合(未必等于胜算):</p>
      <p class="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
        <span v-for="rec in preview.recs" :key="rec.style.id" class="text-[11px] text-ink-soft tabular">
          {{ rec.style.name }}
          <span class="text-gold-ink">{{ starsText(rec.adaptation.stars) }}</span>
        </span>
      </p>
      <p class="mt-1.5 text-[10px] text-ink-faint tabular">
        战力 {{ formatGN(player.finalStats.power) }} · 装备成色、词条与临场随机仍定成败
      </p>
    </div>
    <!--
      灵兽之性折进了下面每档的「遇险 ×N / 行程」里,却不说是它干的 ——
      换伙伴的决定点在这里,把它的跟脚照实摊开(departButtonText 同表)
    -->
    <p v-if="petTripLine" class="mb-2 text-[10px] leading-relaxed text-violet-ink tabular">{{ petTripLine }}</p>
    <!-- 档位名与档数取自 EVENT_TIERS -->
    <p class="mb-2 text-[10px] leading-relaxed text-ink-faint tabular">
      途中{{ cnNumber(EVENT_TIERS.length) }}档:
      <template v-for="(t, i) in EVENT_TIERS" :key="t.id">
        <span v-if="i > 0"> · </span>{{ t.name }} {{ tierOddsText(t.id, chainPending, departEventChance) }}
      </template>
    </p>
    <p class="text-[12px] text-ink-faint">此行欲作何打算?</p>
    <p class="mt-1 text-[10px] leading-relaxed text-ink-faint">行程论这一程走多久;「历练遇敌」只令同程妖踪更密,不能缩地成寸。</p>
    <!--
      「N档行程 · 最凶较最稳凶 X 倍」:两个数都从 EXPLORE_MODES 现算。
      从前这句话写死「三档里敌人差了 2.1 倍」,档位扩到六档、最凶抬到 3.9 之后
      它留在原处没动 —— 而注释不渲染,玩家读到的是上一个版本的世界。
    -->
    <p class="mt-0.5 text-[10px] text-ink-faint tabular">
      {{ modeSummary }}
    </p>
    <div class="mt-3 space-y-2">
      <button
        v-for="modeId in exploreModeIds"
        :key="modeId"
        class="flex w-full items-center justify-between rounded-lg border border-ink/20 px-4 py-3 text-left active:scale-98 active:bg-ink/5"
        @click="emit('choose', modeId)"
      >
        <span>
          <span class="font-kai text-[14px] tracking-widest text-ink">{{ EXPLORE_MODES[modeId].name }}</span>
          <span class="ml-2 text-[11px]" :class="risky(modeId) ? 'text-cinnabar' : 'text-ink-faint'">{{ exploreModeRiskLabel(modeId) }}</span>
        </span>
        <span class="text-right text-[11px] text-ink-faint tabular">
          {{ departText(modeId) }}
          <span class="block text-[10px] text-gold-ink">{{ departReward(modeId) }}</span>
          <span v-if="cappedOf(modeId)" class="block text-[10px] text-cinnabar">{{ cappedOf(modeId) }}</span>
        </span>
      </button>
    </div>
  </BaseModal>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import type { ExploreMode, RegionDef } from '@/types'
  import { usePlayerStore } from '@/stores/player'
  import { useDongfuStore } from '@/stores/dongfu'
  import { EXPLORE_MODES, OFFLINE_CAP_HOURS, RISKY_DANGER_MARGIN } from '@/data/constants'
  import {
    exploreBattleGapSec,
    exploreDurationSec,
    exploreEventChance,
    exploreRewardMult,
    explorationFoeDanger
  } from '@/core/exploration'
  import { currentRegionEvent } from '@/core/regionEvent'
  import { expectedWinReward } from '@/core/loot'
  import { modOf } from '@/core/statsCalc'
  import { pendingChainStages } from '@/core/eventEngine'
  import { EVENT_TIERS, tierOddsText } from '@/core/eventTier'
  import { detectBuild } from '@/core/buildDetect'
  import { detectionAdaptation, recommendForRegion, regionEcology, starsText } from '@/core/buildAdvisor'
  import { petDef } from '@/data/pets'
  import { personalityEffects } from '@/core/petPersonality'
  import { departButtonText, exploreModeIds, exploreModeRiskLabel, exploreModeSummaryLine, petTraitTripLine } from '@/ui/adventureText'
  import { cnNumber, formatDuration, formatGN } from '@/utils/format'
  import BaseModal from '@/components/common/BaseModal.vue'

  const props = defineProps<{ region: RegionDef | null }>()
  const emit = defineEmits<{
    close: []
    choose: [mode: ExploreMode]
  }>()

  const player = usePlayerStore()

  /**
   * 朱砂标险:凶险须高出奖励 5% 以上(见 exploreModes.spec 的同名判据)。
   * 不用裸 `>`:`deep` 的 1.45 对 1.4 是小险,会被误判成险。
   */
  function risky(mode: ExploreMode): boolean {
    const def = EXPLORE_MODES[mode]
    return def.dangerMult > def.rewardMult * RISKY_DANGER_MARGIN
  }

  /** 「N档行程 · 最凶较最稳凶 X 倍」,两个数在 ui/adventureText 里由 EXPLORE_MODES 现算 */
  const modeSummary = exploreModeSummaryLine()


  /** 行程超出洞府离线上限时的标注:离线只结到上限 */
  function cappedOf(mode: ExploreMode): string {
    const capSec = useDongfuStore().offlineCapHours * 3600
    const durationSec = exploreDurationSec(mode, player.petId)
    if (durationSec <= capSec) return ''
    // 差多少与「怎么解」一起给:只说「只结到 X」,玩家仍不知道该升级洞府还是换档
    const needLv = OFFLINE_CAP_HOURS.findIndex(h => h * 3600 >= durationSec)
    const hint = needLv >= 0 ? ` · 洞府 ${needLv} 级可结满` : ''
    return `离线只结到 ${formatDuration(capSec)}(洞府上限)${hint}`
  }

  const currentBuild = computed(() => detectBuild(player.finalStats.mods))

  /** 有无缘在续:决定三档此刻的稀度(引擎先掷奇缘、再掷机缘,余下才是际遇) */
  const chainPending = computed(() => pendingChainStages(player.major).length > 0)

  /** 出发前的三档实算率:与途中同一条乘链(星象/福缘/区域事件 eventMult),按选中地域算 */
  const departEventChance = computed(() => exploreEventChance(props.region?.id ?? '', player.finalStats.mods))

  /** 出发预览:当前构筑适配 + 推荐方向 */
  const preview = computed(() => {
    if (!props.region) return null
    const eco = regionEcology(props.region)
    const mine = currentBuild.value ? detectionAdaptation(currentBuild.value, eco) : null
    const recs = recommendForRegion(props.region).slice(0, 2)
    return { mine, recs }
  })

  /** 灵兽之性那一行(遇险/行程/掉宝/护持,与结算同表);无伴为空 */
  const petTripLine = computed(() => {
    if (!player.petId) return ''
    const def = petDef(player.petId)
    if (!def) return ''
    return petTraitTripLine(def.name, personalityEffects(player.petId))
  })

  function departText(mode: ExploreMode): string {
    const region = props.region
    if (!region) return ''
    const eventId = currentRegionEvent(region.id)?.eventId ?? null
    const danger = explorationFoeDanger({
      tier: region.tier,
      mode,
      regionDanger: region.danger,
      petId: player.petId,
      eventId
    }).total
    return departButtonText({
      durationSec: exploreDurationSec(mode, player.petId),
      rewardMult: exploreRewardMult(mode, eventId),
      dangerMult: danger,
      battleGapSec: exploreBattleGapSec(modOf(player.finalStats.mods, 'explorationSpeed'))
    })
  }

  /** 一胜的期望所得(与 afterWin 同公式的均值) */
  function departReward(mode: ExploreMode): string {
    const region = props.region
    if (!region) return ''
    const eventId = currentRegionEvent(region.id)?.eventId ?? null
    const r = expectedWinReward(region, exploreRewardMult(mode, eventId))
    return `一胜约 ${formatGN(r.stone)} 石 · ${formatGN(r.exp)} 修为`
  }
</script>
