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
        <span v-else-if="growthText !== ''">{{ growthText }}</span>
      </div>
      <!-- 一剑预判:托管据此决定是否出手(能补刀/站得住就打,打不过蓄势留剑) -->
      <p
        v-if="assessInfo !== null"
        class="mt-1 text-[11px]"
        :class="assessInfo.hot ? 'text-cinnabar' : 'text-ink-faint'"
      >
        <span class="opacity-70">预判 · </span>{{ assessInfo.text }}
      </p>

      <!-- 出剑难度:妖王越凶削血越难,击杀赏格越厚;出剑无资粮,推倒才论功行赏 -->
      <div class="mt-3">
        <span class="text-[11px] text-ink-soft">出剑难度</span>
        <div class="mt-1.5 flex gap-1.5">
          <button
            v-for="d in BOSS_DIFFICULTY_OPTIONS"
            :key="d.key"
            class="min-h-[30px] flex-1 rounded-md border px-2 py-1 text-[12px] active:scale-95"
            :class="settings.bossDifficulty === d.key ? 'border-cinnabar/60 bg-cinnabar/10 text-cinnabar' : 'border-ink/15 text-ink-soft'"
            @click="setDifficulty(d.key)"
          >
            {{ d.name }}
          </button>
        </div>
        <p class="mt-1 text-[10px] leading-relaxed text-ink-faint">{{ difficultyHint }}</p>
      </div>

      <button
        class="btn-ink mt-3 w-full"
        :disabled="!alive || usedUp || striking"
        @click="strike"
      >
        {{ strikeLabel }}
      </button>

      <!-- 战报 -->
      <div v-if="lastResult" class="mt-3 rounded-md border border-ink/15 bg-paper-deep/60 px-3 py-2 text-[12px] leading-relaxed text-ink-soft">
        <template v-if="lastResult.killed">
          <p class="text-cinnabar">妖王陨落!击杀赏已按功均分({{ lastResult.recipients }} 人),各自领取。</p>
          <p v-if="lastResult.equipWinner !== null" class="text-gold-ink">妖王遗宝 · 「{{ lastResult.equipWinner }}」得之。</p>
        </template>
        <p>
          十回合连斩,共伤 {{ lastResult.damageText }}
          <template v-if="lastResult.fell"> · 身陨犹战,余刃减半</template>
        </p>
        <p class="text-ink-faint">
          <template v-if="!lastResult.killed">未竟全功 · 无资粮;妖王被推倒时,凡出过剑者按功均分。</template>
          <template v-else>资粮入「击杀赏」,点按上方领取。</template>
        </p>
      </div>

      <!-- 击杀赏待领 -->
      <button
        v-if="pendingInfo !== null"
        class="mt-3 w-full rounded-md border border-gold-ink/50 bg-gold-ink/10 px-3 py-2 text-[12px] text-gold-ink active:scale-98"
        @click="claim"
      >
        领取击杀赏 · 灵石 {{ pendingInfo.stone }} · 灵草 +{{ pendingInfo.herb }}<template v-if="pendingInfo.equip"> · 有妖王遗宝!</template>
      </button>
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
          <tr v-for="(row, i) in boss.top" :key="i" class="border-t border-ink/15">
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
  import { useSettingsStore } from '@/stores/settings'
  import { cloudApi, onCloudWs, type BossState, type BossStrikeResult } from '@/services/cloud'
  import { BOSS_DIFFICULTY_OPTIONS, type BossDifficulty } from '@/data/bossDifficulty'
  import { gn } from '@/utils/gnum'
  import { formatGN } from '@/utils/format'
  import { realmLabel } from '@/data/realms'
  import { claimBossLoot } from '@/core/bossLoot'

  const ui = useUiStore()
  const player = usePlayerStore()
  const settings = useSettingsStore()

  const boss = ref<BossState | null>(null)
  const striking = ref(false)
  const claiming = ref(false)
  const lastResult = ref<BossStrikeResult | null>(null)
  const now = ref(Date.now())
  let tick: ReturnType<typeof setInterval> | undefined
  const unsubWs = onCloudWs(msg => {
    if (msg.type === 'boss_killed') {
      const tail = msg.equipWinner != null && msg.equipWinner !== '' ? ` · 遗宝归于 ${msg.equipWinner}` : ''
      ui.toast(`${msg.name}已陨落 · ${msg.by} 予最后一击${tail}`, 'success')
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
    boss.value === null ? '' : `今日出剑 余 ${Math.max(0, boss.value.maxAttempts - Math.min(boss.value.myAttempts, boss.value.maxAttempts))}/${boss.value.maxAttempts}`
  )
  /** 妖王成长:周期内被击杀越多次,下只越强 */
  const growthText = computed(() => {
    const g = boss.value?.growth
    if (g === undefined) return ''
    return g.killCount > 0 ? `周期击杀 ${g.killCount} · 强度 ×${g.mult}` : ''
  })
  /** 一剑预判文案:与托管同源的服务端评估(能补刀 / 站得住 / 蓄势 / 临期兜底) */
  const assessInfo = computed<{ text: string; hot: boolean } | null>(() => {
    const a = boss.value?.assess
    if (a === undefined || !alive.value || usedUp.value) return null
    const pct = a.hpShare >= 1 ? '几可补' : a.hpShare < 0.005 ? '不足 1%' : `${Math.round(a.hpShare * 100)}%`
    if (a.reason === 'finish') return { text: '一剑可补 · 三倍之功', hot: true }
    if (a.reason === 'steady') return { text: `站得住 · 可削 ${pct}`, hot: false }
    if (a.reason === 'last-call') return { text: '力有不及 · 临期兜底出剑', hot: false }
    if (a.reason === 'hold') return { text: `力有不及 · 蓄势留剑(可削 ${pct})`, hot: false }
    return null
  })

  const strikeLabel = computed(() => {
    if (striking.value) return '斗法中……'
    if (!alive.value) return '妖王已陨落'
    if (usedUp.value) return '今日已出剑 · 明日再战'
    return '出剑'
  })

  /** 所选难度档的说明 */
  const difficultyHint = computed(() => {
    const d = BOSS_DIFFICULTY_OPTIONS.find(o => o.key === settings.bossDifficulty)
    return d?.desc ?? ''
  })

  /** 击杀赏待领(boss 未加载或无待领时不亮) */
  const pendingInfo = computed(() => {
    const p = boss.value?.pending
    if (p === undefined) return null
    if (p.stone <= 0 && p.herb <= 0 && !p.equip) return null
    return p
  })

  function setDifficulty(key: BossDifficulty): void {
    if (settings.bossDifficulty === key) return
    settings.bossDifficulty = key
    // 预判随难度档:妖王攻势变了,能否站稳/补刀要重算
    void reload()
  }

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

  async function reload(): Promise<void> {
    try {
      boss.value = await cloudApi.boss(settings.bossDifficulty)
    } catch {
      // 云不可达时静默,保底显示
    }
  }

  async function strike(): Promise<void> {
    if (striking.value) return
    striking.value = true
    try {
      const r = await cloudApi.bossStrike(settings.bossDifficulty)
      lastResult.value = r
      if (r.killed) ui.toast(`${r.bossName}已陨落!`, 'success')
      await reload()
    } catch (e) {
      ui.toast(e instanceof Error && e.message !== '' ? e.message : '出剑失败', 'warn')
    } finally {
      striking.value = false
    }
  }

  /** 领取击杀赏:资粮即领,装备按自身境界生成入包(与托管同一条路) */
  async function claim(): Promise<void> {
    if (claiming.value) return
    claiming.value = true
    try {
      const got = await claimBossLoot()
      if (got === null) {
        ui.toast('暂无可领的击杀赏', 'info')
      } else {
        ui.toast(`击杀赏已领 · 灵石 ${got.stoneText} · 灵草 +${got.herb}`, 'success')
        if (got.equipLine !== null) ui.toast(`妖王遗宝:${got.equipLine}`, 'rare')
      }
      await reload()
    } catch (e) {
      ui.toast(e instanceof Error && e.message !== '' ? e.message : '领取失败', 'warn')
    } finally {
      claiming.value = false
    }
  }

  onMounted(() => {
    void reload()
    // 进页即领:击杀赏不领一直挂在台账上(离线期间的份也在)
    void claimBossLoot()
      .then(got => {
        if (got !== null) {
          ui.toast(`击杀赏已领 · 灵石 ${got.stoneText} · 灵草 +${got.herb}`, 'success')
          if (got.equipLine !== null) ui.toast(`妖王遗宝:${got.equipLine}`, 'rare')
        }
      })
      .catch(() => undefined)
    tick = setInterval(() => {
      now.value = Date.now()
    }, 1000)
  })
  onUnmounted(() => {
    clearInterval(tick)
    unsubWs()
  })
</script>
