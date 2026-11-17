<template>
  <div class="card-ink flex flex-col px-3 py-3">
    <div class="flex items-start gap-2.5">
      <span class="grid h-9 w-9 shrink-0 place-items-center rounded-md" :class="level > 0 ? 'bg-cinnabar/10 text-ink' : 'bg-ink/5 text-ink-faint'">
        <GameIcon :name="def.icon" :size="18" />
      </span>
      <div class="min-w-0 grow">
        <p class="truncate font-kai text-[14px] leading-snug" :title="def.name" :class="level > 0 ? 'text-ink' : 'text-ink-soft'">
          {{ def.name }}
        </p>
        <p class="mt-0.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
          <!-- 山门不封顶,只报当前级;其余按山门给的余地报「N/上限」 -->
          <span class="shrink-0 text-[10px] tabular text-ink-faint">{{ isHall ? `${level} 级` : `${level}/${cap} 级` }}</span>
          <span v-if="gateLimited" class="shrink-0 rounded border border-amber-ink/40 bg-amber-ink/10 px-1.5 py-0.5 text-[10px] leading-none text-ink">辖于山门</span>
          <span v-if="!gateLimited && timeCut > 0" class="shrink-0 text-[10px] leading-none text-jade">营造 -{{ timeCut }}%</span>
        </p>
      </div>
    </div>

    <p class="mt-2 grow text-[11px] leading-relaxed text-ink-faint">
      {{ level > 0 ? def.effectText(level) : def.desc }}
    </p>
    <p v-if="level > 0" class="mt-1 text-[10px] leading-relaxed text-ink-faint">
      下一级:<span class="text-ink-soft">{{ def.effectText(level + 1) }}</span>
    </p>

    <!-- 在造:倒计时;收取是有职者的事,门人只看得见进度 -->
    <div v-if="building" class="mt-2 rounded-md border border-ink/10 bg-paper-deep/50 px-2.5 py-2">
      <p class="flex items-baseline justify-between gap-2 text-[10px] text-ink-faint">
        <span>营造至 {{ building.to }} 级</span>
        <span class="tabular" :class="remainSec > 0 ? 'text-gold-ink' : 'text-jade'">
          {{ remainSec > 0 ? formatCountdown(remainSec) : '可收取' }}
        </span>
      </p>
      <ProgressBar class="mt-1.5 px-0" :value="progress" :height="2" />
      <button
        v-if="sect.canBuild"
        class="btn-ghost mt-2 w-full !py-1.5 !text-[12px]"
        :disabled="remainSec > 0 || sect.pending"
        @click="claim()"
      >
        {{ remainSec > 0 ? '尚在营造' : '收 取' }}
      </button>
      <p v-else class="mt-2 text-center text-[10px] text-ink-faint">完工后由掌门、副掌门或长老收取</p>
    </div>

    <button
      v-else
      class="btn-ghost mt-2 w-full !py-1.5 !text-[12px]"
      :disabled="!canStart"
      :aria-label="canStart ? undefined : blockLine"
      @click="start()"
    >
      <template v-if="canStart">
        <span class="whitespace-nowrap">营 造 ·</span>
        <span class="whitespace-nowrap">{{ cost }} 贡献</span>
        <span class="whitespace-nowrap">· {{ timeLine }}</span>
      </template>
      <template v-else>{{ blockLine }}</template>
    </button>
  </div>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import GameIcon from '@/components/common/GameIcon.vue'
  import ProgressBar from '@/components/common/ProgressBar.vue'
  import type { SectBuildingDef } from '@/data/sect'
  import { buildingCost, buildingDurationMs, hallTimeRate } from '@/core/sectRules'
  import { useSectStore } from '@/stores/sect'
  import { useWallNow } from '@/composables/useWallClock'
  import { formatCountdown, formatDuration } from '@/utils/format'

  const props = defineProps<{ def: SectBuildingDef }>()

  const sect = useSectStore()
  /** 墙钟读数:营造按墙钟走,暂停也不该冻住倒计时 */
  const now = useWallNow()

  const level = computed(() => sect.buildingLevel(props.def.id))
  /** 山门自己无上限;其余建筑的上限由山门抬(见 core/sectRules 的 buildingLevelCap) */
  const isHall = computed(() => props.def.id === 'hall')
  const cap = computed(() => sect.levelCap(props.def.id))
  /** 未到品类上限却被山门闸住 —— 门派建筑没有品类满级,所以只有这一种「暂时升不动」 */
  const gateLimited = computed(() => !isHall.value && level.value >= cap.value)

  /** 队列里属于这座的那一份(1.72.0 起可多座并行) */
  const building = computed(() => sect.state.build.find(t => t.id === props.def.id) ?? null)
  const remainSec = computed(() => {
    const task = building.value
    if (!task) return 0
    // 服务端时刻 = 本机墙钟 + 时差;不用本机时间直接减,免得设备时钟偏了倒计时先归零
    return Math.max(0, Math.ceil((task.finishAt - (now.value + sect.offset)) / 1000))
  })
  const progress = computed(() => {
    const task = building.value
    if (!task) return 0
    const total = Math.max(1, task.finishAt - task.startAt)
    return Math.min(1, Math.max(0, (now.value + sect.offset - task.startAt) / total))
  })

  const cost = computed(() => buildingCost(props.def.id, level.value, sect.rate) ?? 0)
  /** 工期吃山门减免(每级 -1%,封顶 -60%):与服务端同一把尺 */
  const hallLevel = computed(() => sect.buildingLevel('hall'))
  const durationMs = computed(() => buildingDurationMs(props.def.id, level.value, hallLevel.value) ?? 0)
  const timeLine = computed(() => formatDuration(Math.ceil(durationMs.value / 1000)))
  /** 山门已省下的工期百分比:0 时不提,免得每张卡都挂一句「-0%」 */
  const timeCut = computed(() => Math.round((1 - hallTimeRate(hallLevel.value)) * 100))

  /** 队列满没满(容量随山门 20/40/60/80 级各开一位);同座重复开工由服务端挡,客户端只管容量 */
  const queueFull = computed(() => sect.state.build.length >= sect.queueCap)
  const canStart = computed(
    () =>
      sect.canBuild &&
      !gateLimited.value &&
      !building.value &&
      !queueFull.value &&
      sect.pool >= cost.value &&
      !sect.pending
  )
  const blockLine = computed(() => {
    // 门人不开工:营造是有职者(掌门/副掌门/长老)的事
    if (!sect.canBuild) return '有职者方可营造'
    // 上限 = (山门+1)×2 → 要再升一级,山门须到 floor(当前等级 / 2)
    if (gateLimited.value) return `需山门 ${Math.floor(level.value / 2)} 级`
    if (building.value) return '尚在营造'
    if (queueFull.value) return '营造队列已满 · 山门 20/40/60/80 级各增一位'
    return `门派库不足 · 差 ${Math.max(0, cost.value - sect.pool)}`
  })

  function start(): void {
    if (!canStart.value) return
    void sect.startBuild(props.def.id)
  }

  function claim(): void {
    if (remainSec.value > 0) return
    void sect.claimBuild()
  }
</script>
