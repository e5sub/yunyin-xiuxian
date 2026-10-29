<template>
  <div class="stagger-in space-y-4 px-4 pb-6 pt-4">
    <SectionTitle title="万妖围城" hint="全服共讨 · 每日一剑" />

    <!-- 妖王牌 -->
    <div class="card-ink px-4 py-4">
      <div class="flex items-baseline justify-between">
        <div class="flex items-baseline gap-2">
          <span class="font-kai text-[19px] tracking-widest" :class="boss?.alive === false ? 'text-ink-faint' : 'text-cinnabar'">
            {{ boss?.name ?? '……' }}
          </span>
          <span class="text-[11px] text-ink-faint">{{ realmText }}</span>
        </div>
        <span class="text-[11px] text-ink-faint">{{ attemptsText }}</span>
      </div>

      <!-- 血条:GNum 比值,百分比截 0-100 -->
      <div class="mt-3 h-2 w-full overflow-hidden rounded-full bg-ink/10">
        <div class="h-full rounded-full transition-all duration-500" :class="alive ? 'bg-cinnabar/80' : 'bg-ink/20'" :style="{ width: hpPct + '%' }" />
      </div>
      <div class="mt-1.5 flex items-baseline justify-between text-[11px] text-ink-faint">
        <span>气血 {{ hpText }} / {{ maxHpText }}</span>
        <span v-if="!alive">再临:{{ respawnText }}</span>
      </div>

      <button
        class="btn-ink mt-4 w-full"
        :disabled="!alive || usedUp || striking"
        @click="strike"
      >
        {{ strikeLabel }}
      </button>

      <!-- 战报 -->
      <div v-if="lastResult" class="mt-3 rounded-md border border-border-weak bg-bg-secondary px-3 py-2 text-[12px] leading-relaxed text-ink-soft">
        <template v-if="lastResult.killed">
          <p class="text-cinnabar">妖王陨落!余众溃散。</p>
        </template>
        <p>
          十回合连斩,共伤 {{ lastResult.damageText }}
          <template v-if="lastResult.fell"> · 身陨犹战,余刃减半</template>
        </p>
        <p class="text-ink-faint">
          资粮:灵石 +{{ rewardStoneText }} · {{ herbText }}灵草 +{{ lastResult.reward.herb }}
          <template v-if="lastResult.killed">(讨伐之功,三倍)</template>
        </p>
      </div>
    </div>

    <!-- 贡献榜:表格视图 -->
    <div class="card-ink px-4 py-4">
      <div class="mb-2 flex items-baseline justify-between">
        <span class="font-kai text-[13px] tracking-widest text-ink">讨伐名录</span>
        <span class="text-[11px] text-ink-faint">本周妖王累计</span>
      </div>
      <table v-if="boss !== null && boss.top.length > 0" class="w-full text-[12px]">
        <thead>
          <tr class="text-left text-[11px] text-ink-faint">
            <th class="py-1 font-normal">道号</th>
            <th class="py-1 text-right font-normal">累积伤害</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, i) in boss.top" :key="i" class="border-t border-border-weak">
            <td class="py-1.5 text-ink" :class="row.name === myName ? 'text-cinnabar' : ''">{{ row.name }}</td>
            <td class="py-1.5 text-right font-mono text-ink-soft">{{ row.dmgText }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="py-2 text-center text-[12px] text-ink-faint">尚无道友出剑</p>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { computed, onMounted, onUnmounted, ref } from 'vue'
  import SectionTitle from '@/components/common/SectionTitle.vue'
  import { useUiStore } from '@/stores/ui'
  import { usePlayerStore } from '@/stores/player'
  import { useResourcesStore } from '@/stores/resources'
  import { cloudApi, onCloudWs, type BossState, type BossStrikeResult } from '@/services/cloud'
  import { gn } from '@/utils/gnum'
  import { formatGN } from '@/utils/format'
  import { stoneByTier } from '@/core/formulas'
  import { tierOfMajor } from '@/core/secretRealm'
  import { realmLabel } from '@/data/realms'
  import { herbGradeOfMajor, HERB_GRADE_SHORT } from '@/data/herbGrades'

  const ui = useUiStore()
  const player = usePlayerStore()
  const resources = useResourcesStore()

  const boss = ref<BossState | null>(null)
  const striking = ref(false)
  const lastResult = ref<BossStrikeResult | null>(null)
  const now = ref(Date.now())
  let tick: ReturnType<typeof setInterval> | undefined
  const unsubWs = onCloudWs(msg => {
    if (msg.type === 'boss_killed') {
      ui.toast(`${msg.name}已陨落 · ${msg.by} 予最后一击`, 'success')
      void reload()
    } else if (msg.type === 'boss_spawn') {
      ui.toast(`${msg.name}再临人间`, 'info')
      void reload()
    }
  })

  const myName = computed(() => player.name)
  const alive = computed(() => boss.value?.alive === true)
  const usedUp = computed(() => boss.value !== null && boss.value.myAttempts >= boss.value.maxAttempts)
  const realmText = computed(() =>
    boss.value === null ? '' : `境界 · ${realmLabel(Math.max(0, boss.value.realmIndex), 0)}`
  )
  const attemptsText = computed(() =>
    boss.value === null ? '' : `今日出剑 ${Math.min(boss.value.myAttempts, boss.value.maxAttempts)}/${boss.value.maxAttempts}`
  )
  const strikeLabel = computed(() => {
    if (striking.value) return '斗法中……'
    if (!alive.value) return '妖王已陨落'
    if (usedUp.value) return '今日已出剑 · 明日再战'
    return '出剑'
  })

  function pctOf(part: { m: number; e: number }, full: { m: number; e: number }): number {
    const a = gn(part)
    const b = gn(full)
    if (b.m <= 0) return 0
    const diff = a.e - b.e
    if (diff > 3) return 100
    if (diff < -3) return 0
    const pct = (a.m / b.m) * Math.pow(10, diff) * 100
    return Math.max(0, Math.min(100, pct))
  }

  const hpPct = computed(() =>
    boss.value === null ? 0 : alive.value ? pctOf(boss.value.hp, boss.value.maxHp) : 0
  )
  const hpText = computed(() => (boss.value === null ? '' : formatGN(gn(boss.value.hp))))
  const maxHpText = computed(() => (boss.value === null ? '' : formatGN(gn(boss.value.maxHp))))
  const respawnText = computed(() => {
    if (boss.value === null || boss.value.respawnAt === 0) return ''
    const sec = Math.max(0, Math.ceil((boss.value.respawnAt - now.value) / 1000))
    const h = Math.floor(sec / 3600)
    const m = Math.floor((sec % 3600) / 60)
    return h > 0 ? `${h}时${m}分` : `${m}分${sec % 60}秒`
  })
  const rewardStoneText = computed(() =>
    lastResult.value === null ? '' : formatGN(stoneByTier(tierOfMajor(Math.max(0, lastResult.value.tier)), lastResult.value.reward.stone))
  )
  const herbText = computed(() => (lastResult.value === null ? '' : HERB_GRADE_SHORT[herbGradeOfMajor(player.major)]))

  async function reload(): Promise<void> {
    try {
      boss.value = await cloudApi.boss()
    } catch {
      // 云不可达时静默,保底显示
    }
  }

  async function strike(): Promise<void> {
    if (striking.value) return
    striking.value = true
    try {
      const r = await cloudApi.bossStrike()
      lastResult.value = r
      // 奖励即时入账(数量单位按妖王境界折算),随下次云同步落档
      resources.addStone(stoneByTier(tierOfMajor(Math.max(0, r.tier)), r.reward.stone))
      resources.addSmall('herb', r.reward.herb)
      if (r.killed) ui.toast(`${r.bossName}已陨落!`, 'success')
      await reload()
    } catch (e) {
      ui.toast(e instanceof Error && e.message !== '' ? e.message : '出剑失败', 'warn')
    } finally {
      striking.value = false
    }
  }

  onMounted(() => {
    void reload()
    tick = setInterval(() => {
      now.value = Date.now()
    }, 1000)
  })
  onUnmounted(() => {
    clearInterval(tick)
    unsubWs()
  })
</script>
