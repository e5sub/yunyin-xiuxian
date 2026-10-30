<template>
  <div class="card-ink divide-y divide-ink/6 px-4">
    <!-- VIP 状态行 -->
    <div class="flex items-center justify-between py-3">
      <div class="min-w-0">
        <span class="text-[13px] text-ink-soft">VIP 状态</span>
        <p class="mt-0.5 text-[10px] leading-relaxed text-ink-faint">
          {{ auth.isVip ? `剩余 ${auth.vipDaysLeft} 天(至 ${expireText})` : '未开通 · 可联系仙官(GM)开通' }}
        </p>
      </div>
      <span
        class="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-kai tracking-widest"
        :class="auth.isVip ? 'bg-amber-ink/15 text-amber-ink' : 'bg-ink/10 text-ink-faint'"
      >VIP</span>
    </div>

    <template v-if="auth.isVip">
      <!-- 一键托管 -->
      <div class="flex items-center justify-between py-3">
        <span class="text-[13px] text-ink-soft">一键托管</span>
        <button
          type="button"
          class="chip-ink !py-1.5"
          :class="allOn ? 'border-cinnabar text-cinnabar' : 'border-ink/25 text-ink-faint'"
          @click="toggleAll"
        >
          {{ allOn ? '全关' : '全开' }}
        </button>
      </div>

      <label class="flex items-center justify-between py-3">
        <span class="text-[13px] text-ink-soft">自动打 BOSS</span>
        <input v-model="settings.autoBoss" type="checkbox" class="h-4 w-4 accent-cinnabar" />
      </label>

      <label class="flex items-center justify-between py-3">
        <span class="text-[13px] text-ink-soft">自动闭关</span>
        <input
          v-model="settings.autoRetreat"
          type="checkbox"
          class="h-4 w-4 accent-cinnabar"
          :disabled="settings.autoAdventure"
        />
      </label>

      <div class="py-3">
        <label class="flex items-center justify-between">
          <span class="text-[13px] text-ink-soft">自动历练</span>
          <input
            v-model="settings.autoAdventure"
            type="checkbox"
            class="h-4 w-4 accent-cinnabar"
            :disabled="settings.autoRetreat"
          />
        </label>
        <p class="mt-1 text-[10px] leading-relaxed text-ink-faint">
          历练与闭关互斥:开自动历练时闭关让位,遇事自动按默认好愿了结
        </p>
        <div v-if="settings.autoAdventure" class="mt-2 space-y-2">
          <label class="flex items-center justify-between gap-2">
            <span class="shrink-0 text-[11px] text-ink-faint">历练去处</span>
            <select v-model="settings.autoRegionId" class="min-w-0 grow rounded border border-ink/20 bg-transparent px-1.5 py-1 text-[12px] text-ink">
              <option value="" disabled>选择区域</option>
              <option v-for="r in enterableRegions" :key="r.id" :value="r.id">{{ r.name }}</option>
            </select>
          </label>
          <label class="flex items-center justify-between gap-2">
            <span class="shrink-0 text-[11px] text-ink-faint">出行档位</span>
            <select v-model="settings.autoMode" class="min-w-0 grow rounded border border-ink/20 bg-transparent px-1.5 py-1 text-[12px] text-ink">
              <option v-for="(m, id) in EXPLORE_MODES" :key="id" :value="id">{{ m.name }}({{ classicalDuration(m.durationSec) }})</option>
            </select>
          </label>
          <p v-if="settings.autoRegionId === ''" class="text-[10px] text-cinnabar">须先选历练去处,否则托管不出行</p>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import { useSettingsStore } from '@/stores/settings'
  import { useAuthStore } from '@/stores/auth'
  import { useAdventureStore } from '@/stores/adventure'
  import { canEnterRegion } from '@/core/mortalWorldService'
  import { EXPLORE_MODES } from '@/data/constants'
  import { regionDef } from '@/data/regions'
  import { classicalDuration } from '@/data/timeUnits'

  const settings = useSettingsStore()
  const auth = useAuthStore()

  const allOn = computed(() => settings.autoBoss && settings.autoRetreat && settings.autoAdventure)

  function toggleAll(): void {
    const next = !allOn.value
    settings.autoBoss = next
    // 闭关与历练互斥:一键全开时历练优先
    settings.autoAdventure = next
    settings.autoRetreat = next && !settings.autoAdventure
  }

  /** 当前可进入的区域(须与历练入口同口径:canEnterRegion,而非只看 unlocked) */
  const enterableRegions = computed(() =>
    useAdventureStore()
      .unlocked.map(id => regionDef(id))
      .filter((r): r is NonNullable<ReturnType<typeof regionDef>> => !!r && canEnterRegion(r.id))
  )

  const expireText = computed(() =>
    new Date(auth.vipUntil).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
  )
</script>
