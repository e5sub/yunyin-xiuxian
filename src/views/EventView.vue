<template>
  <div class="stagger-in space-y-4 px-4 pb-6 pt-4">
    <SectionTitle title="周天七会" hint="一日一会 · 服务端裁定 · 北京时间零点换日" />

    <!-- 未登录:活动进度存在服务端,先登录 -->
    <div v-if="!auth.loggedIn" class="card-ink px-4 py-6 text-center text-[12px] text-ink-faint">
      七会名册在云端。登录后可见今日值会与进度。
    </div>

    <template v-else>
      <!-- 今日会 -->
      <div v-if="info !== null" class="card-ink px-4 py-4">
        <div class="flex items-baseline justify-between gap-2">
          <div class="flex items-baseline gap-2">
            <span class="font-kai text-[19px] tracking-widest text-cinnabar">{{ info.event.name }}</span>
            <span class="text-[11px] text-ink-faint">{{ weekdayName(info.event.dow) }}</span>
          </div>
          <span class="shrink-0 text-[10px] text-ink-faint tabular">距换日 {{ tilNext }}</span>
        </div>
        <p class="mt-1 text-[11px] leading-relaxed text-ink-soft">{{ info.event.desc }}</p>
        <p class="mt-1.5 text-[12px] text-ink">{{ info.event.rule }}</p>

        <!-- 进度:擂台报连胜,其余报次数;天榜报名次 -->
        <div class="mt-2 flex items-baseline justify-between gap-2 text-[11px]">
          <span class="text-ink-faint">{{ progressLabel }}</span>
          <span
            class="tabular"
            :class="info.mine.claimed ? 'text-jade' : done ? 'text-gold-ink' : 'text-azure'"
          >{{ progressValue }}</span>
        </div>

        <p class="mt-1 text-[10px] tabular text-azure">赏 {{ rewardText(info.event.reward) }}</p>

        <div class="mt-3 flex gap-2">
          <button
            v-if="info.event.kind === 'arena'"
            class="btn-ink flex-1"
            :disabled="busy || done"
            @click="fight"
          >
            {{ busy ? '台上交锋……' : done ? '今日已成' : '上台连战' }}
          </button>
          <RouterLink v-else :to="info.event.to" class="btn-ink flex-1 text-center">去办</RouterLink>
          <button class="btn-ink flex-1" :disabled="busy || info.mine.claimed || !done" @click="claim">
            {{ info.mine.claimed ? '已领' : '领赏' }}
          </button>
        </div>

        <!-- 擂台战报:逐关 -->
        <div v-if="arenaResult !== null" class="mt-3 rounded-md border border-ink/15 bg-paper-deep/60 px-3 py-2 text-[12px] leading-relaxed">
          <p class="text-ink-soft">本轮连胜 {{ arenaResult.streak }} / {{ arenaResult.target }}</p>
          <p v-for="r in arenaResult.runs" :key="r.round" :class="r.win ? 'text-jade' : 'text-cinnabar'">
            第{{ r.round }}关 · {{ r.foe }} · {{ r.win ? '胜' : '败' }} · {{ r.rounds }} 回合
          </p>
        </div>
      </div>

      <!-- 七日一览 -->
      <div class="card-ink px-4 py-4">
        <p class="font-kai text-[13px] tracking-widest text-ink">七日轮值</p>
        <table class="mt-2 w-full text-[12px]">
          <tbody>
            <tr
              v-for="e in info?.week ?? []"
              :key="e.id"
              class="border-t border-ink/15 align-top"
              :class="e.id === info?.event.id ? 'text-cinnabar' : 'text-ink-soft'"
            >
              <td class="whitespace-nowrap py-2 pr-2 text-[11px] text-ink-faint">{{ weekdayName(e.dow) }}</td>
              <td class="py-2 pr-2 font-kai tracking-wider">{{ e.name }}</td>
              <td class="py-2 text-[11px] leading-relaxed text-ink-faint">{{ e.rule }}</td>
            </tr>
          </tbody>
        </table>
        <p class="mt-2 text-[10px] leading-relaxed text-ink-faint">
          每会一天一次,赏由服务端按当日进度发放;错过当日不再补,次日另起一会。
        </p>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
  import { computed, onMounted, onUnmounted, ref } from 'vue'
  import SectionTitle from '@/components/common/SectionTitle.vue'
  import { useAuthStore } from '@/stores/auth'
  import { usePlayerStore } from '@/stores/player'
  import { useResourcesStore } from '@/stores/resources'
  import { useUiStore } from '@/stores/ui'
  import { cloudApi, type EventArenaResult, type EventReward, type EventToday } from '@/services/cloud'
  import { stoneByTier } from '@/core/formulas'
  import { tierOfMajor } from '@/core/secretRealm'
  import { formatGN } from '@/utils/format'
  import { HERB_GRADE_SHORT, herbGradeOfMajor } from '@/data/herbGrades'
  import { eventDone, eventProgressLabel, eventProgressValue, eventRewardParts, weekdayName, type RewardKey } from '@/ui/sevenDayText'

  const auth = useAuthStore()
  const player = usePlayerStore()
  const resources = useResourcesStore()
  const ui = useUiStore()

  const info = ref<EventToday | null>(null)
  const arenaResult = ref<EventArenaResult | null>(null)
  const busy = ref(false)

  /** 今日是否达标:与领赏判定同源(见 ui/sevenDayText) */
  const done = computed(() => (info.value === null ? false : eventDone(info.value.event, info.value.mine.progress, info.value.rank)))

  const progressLabel = computed(() => (info.value === null ? '' : eventProgressLabel(info.value.event)))

  const progressValue = computed(() =>
    info.value === null ? '' : eventProgressValue(info.value.event, info.value.mine.progress, info.value.rank)
  )

  function rewardText(r: EventReward): string {
    const tier = tierOfMajor(Math.max(0, player.major))
    const label: Record<RewardKey, string> = {
      stone: `灵石 ${formatGN(stoneByTier(tier, r.stone))}`,
      wudao: `悟道 ${r.wudao}`,
      herb: `${HERB_GRADE_SHORT[herbGradeOfMajor(player.major)]}灵草 ${r.herb}`,
      ore: `玄铁 ${r.ore}`,
      dust: `器灵尘 ${r.dust}`,
      page: `残页 ${r.page}`
    }
    return eventRewardParts(r)
      .map(p => label[p.key])
      .join(' · ')
  }

  async function reload(): Promise<void> {
    try {
      info.value = await cloudApi.eventToday()
    } catch (e) {
      ui.toast(e instanceof Error && e.message !== '' ? e.message : '活动名册拉取失败', 'warn')
    }
  }

  async function fight(): Promise<void> {
    if (busy.value) return
    busy.value = true
    try {
      arenaResult.value = await cloudApi.eventArena()
      const r = arenaResult.value
      ui.toast(`第 ${r.runs.length} 关止步 · 本轮连胜 ${r.streak} / ${r.target}`, r.streak >= r.target ? 'success' : 'info')
      await reload()
    } catch (e) {
      ui.toast(e instanceof Error && e.message !== '' ? e.message : '开战失败', 'warn')
    } finally {
      busy.value = false
    }
  }

  async function claim(): Promise<void> {
    if (busy.value) return
    busy.value = true
    try {
      const r = await cloudApi.eventClaim()
      const tier = tierOfMajor(Math.max(0, player.major))
      if (r.reward.stone > 0) resources.addStone(stoneByTier(tier, r.reward.stone))
      if (r.reward.wudao > 0) resources.addSmall('wudao', r.reward.wudao)
      if (r.reward.herb > 0) resources.addSmall('herb', r.reward.herb)
      if (r.reward.ore > 0) resources.addSmall('ore', r.reward.ore)
      if (r.reward.dust > 0) resources.addSmall('dust', r.reward.dust)
      if (r.reward.page > 0) resources.addSmall('page', r.reward.page)
      ui.toast(`七会赏已领 · ${rewardText(r.reward)}`, 'success')
      await reload()
    } catch (e) {
      ui.toast(e instanceof Error && e.message !== '' ? e.message : '领取失败', 'warn')
    } finally {
      busy.value = false
    }
  }

  // 换日倒计时按服务端给的下次换日时刻走墙钟,不读本机时区
  const nowTick = ref(Date.now())
  let timer: ReturnType<typeof setInterval> | undefined
  const deadline = computed(() => (info.value === null ? 0 : info.value.now + info.value.secsToNext * 1000))
  const tilNext = computed(() => {
    const left = Math.max(0, Math.floor((deadline.value - nowTick.value) / 1000))
    const h = Math.floor(left / 3600)
    const m = Math.floor((left % 3600) / 60)
    const s = left % 60
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  })

  onMounted(() => {
    void reload()
    timer = setInterval(() => {
      nowTick.value = Date.now()
      // 跨过换日点即重拉:活动自己换,不必等玩家重进
      if (deadline.value > 0 && nowTick.value >= deadline.value) void reload()
    }, 1000)
  })
  onUnmounted(() => {
    if (timer !== undefined) clearInterval(timer)
  })
</script>
