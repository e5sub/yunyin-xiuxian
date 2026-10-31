<template>
  <div class="stagger-in space-y-4 px-4 pb-6 pt-4">
    <SectionTitle title="闲趣三则" hint="观星一签 · 垂钓三竿 · 猜谜一问" />

    <div v-if="!auth.loggedIn" class="card-ink px-4 py-6 text-center text-[12px] text-ink-faint">
      闲趣记在云端。登录后可观星、可垂钓、可答题。
    </div>

    <template v-else>
      <!-- 观星 -->
      <div class="card-ink px-4 py-4">
        <div class="flex items-baseline justify-between gap-2">
          <span class="font-kai text-[16px] tracking-widest text-ink">观星台</span>
          <span class="text-[10px] text-ink-faint">一日一签</span>
        </div>

        <p v-if="info !== null && info.star.fortune === null" class="mt-2 text-[11px] leading-relaxed text-ink-soft">
          夜里无云,星斗分明。摇一签,看今夜天道偏向何处。
        </p>

        <template v-else-if="info !== null && info.star.fortune !== null">
          <p class="mt-2 font-kai text-[15px] leading-relaxed" :class="tone">{{ info.star.fortune.poem }}</p>
          <p class="mt-1 text-[11px] leading-relaxed text-ink-soft">{{ info.star.fortune.read }}</p>
          <p class="mt-1.5 text-[10px] tabular text-azure">签赏 {{ rewardText(info.star.fortune.reward) }}</p>
        </template>

        <button class="btn-ink mt-3 w-full" :disabled="starBusy || info === null || info.star.drawn" @click="draw">
          {{ info?.star.drawn === true ? '今日已观' : starBusy ? '仰首看天……' : '夜观星象' }}
        </button>
      </div>

      <!-- 垂钓 -->
      <div class="card-ink px-4 py-4">
        <div class="flex items-baseline justify-between gap-2">
          <span class="font-kai text-[16px] tracking-widest text-ink">灵泉垂钓</span>
          <span class="text-[10px] tabular text-ink-faint">{{ castHint(info?.fish.casts ?? 0, info?.fish.max ?? 3) }}</span>
        </div>

        <p class="mt-2 text-[11px] leading-relaxed text-ink-soft">
          泉在竹下,水深不见底。钓上什么全凭运气,钓到的先入篓,收篓才入账。
        </p>

        <!-- 逐竿钓获 -->
        <ul v-if="(info?.fish.caught.length ?? 0) > 0" class="mt-2 space-y-1">
          <li v-for="(c, i) in info?.fish.caught ?? []" :key="i" class="text-[12px] leading-relaxed text-ink">
            <span class="text-ink-faint">第{{ i + 1 }}竿</span> · {{ c }}
          </li>
        </ul>

        <div class="mt-2 flex items-baseline justify-between gap-2 text-[11px]">
          <span class="text-ink-faint">篓中</span>
          <span class="tabular" :class="info?.fish.claimed === true ? 'text-jade' : 'text-gold-ink'">
            {{ info?.fish.claimed === true ? '已收篓' : basketText }}
          </span>
        </div>

        <div class="mt-3 flex gap-2">
          <button
            class="btn-ink flex-1"
            :disabled="fishBusy || info === null || info.fish.claimed || info.fish.casts >= info.fish.max"
            @click="cast"
          >
            {{ fishBusy ? '浮子动了……' : info?.fish.casts !== undefined && info.fish.casts >= info.fish.max ? '竿已收' : '起一竿' }}
          </button>
          <button
            class="btn-ink flex-1"
            :disabled="fishBusy || info === null || info.fish.claimed || info.fish.casts === 0"
            @click="claimBasket"
          >
            {{ info?.fish.claimed === true ? '已收' : '收篓' }}
          </button>
        </div>
      </div>

      <!-- 猜谜 -->
      <div class="card-ink px-4 py-4">
        <div class="flex items-baseline justify-between gap-2">
          <span class="font-kai text-[16px] tracking-widest text-ink">山门猜谜</span>
          <span
            class="text-[10px]"
            :class="info?.riddle.answered === true ? (info.riddle.correct === true ? 'text-jade' : 'text-cinnabar') : 'text-ink-faint'"
          >{{ riddleVerdict(info?.riddle.answered ?? false, info?.riddle.correct ?? null) }}</span>
        </div>

        <p class="mt-2 text-[13px] leading-relaxed text-ink">{{ info?.riddle.q ?? '……' }}</p>

        <div class="mt-2 space-y-1.5">
          <button
            v-for="(opt, i) in info?.riddle.options ?? []"
            :key="i"
            class="w-full rounded-md border px-3 py-2 text-left text-[12px] leading-relaxed transition-colors disabled:opacity-100"
            :class="optionClass(i)"
            :disabled="riddleBusy || info === null || info.riddle.answered"
            @click="answer(i)"
          >
            <span class="mr-1.5 text-ink-faint">{{ '甲乙丙丁'[i] }}</span>{{ opt }}
          </button>
        </div>

        <p v-if="info?.riddle.note !== null && info?.riddle.note !== undefined" class="mt-2 text-[11px] leading-relaxed text-ink-soft">
          {{ info.riddle.note }}
        </p>
        <p v-if="riddleResult !== null" class="mt-1 text-[11px] tabular" :class="riddleResult.correct ? 'text-jade' : 'text-ink-faint'">
          {{ riddleResult.correct ? `答对了,得赏 ${rewardText(riddleResult.reward)}` : '答错了,留下一句安慰' }}
        </p>
      </div>

      <p class="px-1 text-[10px] leading-relaxed text-ink-faint">
        三则皆不耗行动次数,也不改战力;每日各一份额度,北京时间零点另起。距换日 {{ tilNext }}。
      </p>
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
  import { cloudApi, type LeisureReward, type LeisureRiddleResult, type LeisureToday } from '@/services/cloud'
  import { stoneByTier } from '@/core/formulas'
  import { tierOfMajor } from '@/core/secretRealm'
  import { formatGN } from '@/utils/format'
  import { HERB_GRADE_SHORT, herbGradeOfMajor } from '@/data/herbGrades'
  import { basketEmpty, castHint, fortuneTone, riddleVerdict } from '@/ui/leisureText'

  const auth = useAuthStore()
  const player = usePlayerStore()
  const resources = useResourcesStore()
  const ui = useUiStore()

  const info = ref<LeisureToday | null>(null)
  const starBusy = ref(false)
  const fishBusy = ref(false)
  const riddleBusy = ref(false)
  const riddleResult = ref<LeisureRiddleResult | null>(null)
  /** 本次作答选了哪一项:答后标出来,刷新页面则只标正确项 */
  const picked = ref<number | null>(null)

  /** 签等配色 */
  const tone = computed(() => fortuneTone(info.value?.star.fortune?.rank ?? 0))

  /** 篓中一句话:空则说「尚无」 */
  const basketText = computed(() => {
    const b = info.value?.fish.basket
    if (b === undefined || basketEmpty(b)) return '尚无'
    return rewardText(b)
  })

  function rewardText(r: LeisureReward): string {
    const tier = tierOfMajor(Math.max(0, player.major))
    const parts: string[] = []
    if (r.stone > 0) parts.push(`灵石 ${formatGN(stoneByTier(tier, r.stone))}`)
    if (r.wudao > 0) parts.push(`悟道 ${r.wudao}`)
    if (r.herb > 0) parts.push(`${HERB_GRADE_SHORT[herbGradeOfMajor(player.major)]}灵草 ${r.herb}`)
    if (r.ore > 0) parts.push(`玄铁 ${r.ore}`)
    if (r.dust > 0) parts.push(`器灵尘 ${r.dust}`)
    if (r.page > 0) parts.push(`残页 ${r.page}`)
    return parts.join(' · ')
  }

  /** 把服务端裁定的一份赏入账(与七会同一条发放路径) */
  function grant(r: LeisureReward): void {
    const tier = tierOfMajor(Math.max(0, player.major))
    if (r.stone > 0) resources.addStone(stoneByTier(tier, r.stone))
    if (r.wudao > 0) resources.addSmall('wudao', r.wudao)
    if (r.herb > 0) resources.addSmall('herb', r.herb)
    if (r.ore > 0) resources.addSmall('ore', r.ore)
    if (r.dust > 0) resources.addSmall('dust', r.dust)
    if (r.page > 0) resources.addSmall('page', r.page)
  }

  function optionClass(i: number): string {
    const r = info.value?.riddle
    if (r === undefined || !r.answered || r.correct === null) return 'border-ink/20 text-ink active:scale-98'
    // 答后:正确项标青,自己选错的那一项标朱,其余淡下去
    if (i === (riddleResult.value?.answer ?? -1)) return 'border-jade/50 bg-jade/10 text-jade'
    if (i === picked.value) return 'border-cinnabar/40 bg-cinnabar/5 text-cinnabar'
    return 'border-ink/15 text-ink-faint'
  }

  async function reload(): Promise<void> {
    try {
      info.value = await cloudApi.leisureToday()
    } catch (e) {
      ui.toast(e instanceof Error && e.message !== '' ? e.message : '闲趣名册拉取失败', 'warn')
    }
  }

  async function draw(): Promise<void> {
    if (starBusy.value) return
    starBusy.value = true
    try {
      const r = await cloudApi.leisureStar()
      if (!r.already) {
        grant(r.reward)
        ui.toast(`${r.fortune.grade} · ${r.fortune.poem}`, r.fortune.rank >= 2 ? 'success' : 'info')
      }
      await reload()
    } catch (e) {
      ui.toast(e instanceof Error && e.message !== '' ? e.message : '今夜无星', 'warn')
    } finally {
      starBusy.value = false
    }
  }

  async function cast(): Promise<void> {
    if (fishBusy.value) return
    fishBusy.value = true
    try {
      const r = await cloudApi.leisureCast()
      ui.toast(r.catch.label, basketEmpty(r.catch.reward) ? 'info' : 'success')
      await reload()
    } catch (e) {
      ui.toast(e instanceof Error && e.message !== '' ? e.message : '起竿失败', 'warn')
    } finally {
      fishBusy.value = false
    }
  }

  async function claimBasket(): Promise<void> {
    if (fishBusy.value) return
    fishBusy.value = true
    try {
      const r = await cloudApi.leisureClaimBasket()
      grant(r.reward)
      ui.toast(basketEmpty(r.reward) ? '空篓一只,倒也清净' : `收篓 · ${rewardText(r.reward)}`, basketEmpty(r.reward) ? 'info' : 'success')
      await reload()
    } catch (e) {
      ui.toast(e instanceof Error && e.message !== '' ? e.message : '收篓失败', 'warn')
    } finally {
      fishBusy.value = false
    }
  }

  async function answer(i: number): Promise<void> {
    if (riddleBusy.value) return
    riddleBusy.value = true
    try {
      const r = await cloudApi.leisureAnswer(i)
      picked.value = i
      riddleResult.value = r
      if (!r.already) grant(r.reward)
      ui.toast(r.correct ? '答对了' : '答错了', r.correct ? 'success' : 'info')
      await reload()
    } catch (e) {
      ui.toast(e instanceof Error && e.message !== '' ? e.message : '答谜失败', 'warn')
    } finally {
      riddleBusy.value = false
    }
  }

  // 换日倒计时走服务端给的下次换日时刻,不看本机时区
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
      if (deadline.value > 0 && nowTick.value >= deadline.value) void reload()
    }, 1000)
  })
  onUnmounted(() => {
    if (timer !== undefined) clearInterval(timer)
  })
</script>
