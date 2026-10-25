import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { usePlayerStore } from '@/stores/player'
import {
  currentStatGuard,
  currentTribulationPlan,
  currentTribulationRelief,
  currentTribResist,
  guardScore,
  statFoldAt,
  sustainScore,
  tribReduction,
  tribLowHpReduction,
  tribulationWaveSpan,
  type TribulationPlan
} from '@/core/tribulationDecision'
import { reliefElements, rootElements } from '@/core/linggenAffinity'
import { todayWeather } from '@/core/weather'
import { weatherTribulationLine } from '@/ui/weatherText'

/** 劫势评估的整本账:修行页摘要卡与劫势详情面板同读这一份 */
export function useTribulation(needTribulation: MaybeRefOrGetter<boolean>) {
  const player = usePlayerStore()

  /** 决意前的劫型配色,只在摘要卡用 */
  const PLAN_COLOR: Record<TribulationPlan['verdict'], string> = {
    danger: 'text-cinnabar',
    hard: 'text-amber-ink',
    ok: 'text-azure',
    easy: 'text-jade'
  }

  const tribPlan = computed(() => (toValue(needTribulation) ? currentTribulationPlan() : null))

  const tribTargetMajor = computed(() => (player.isMajorStep ? player.major + 1 : player.major))
  /** 这一劫是否「界膜」(人间→仙界 / 仙界→神界 / 神界→混沌海);判据取 statFoldAt,与结算同源 */
  const worldStep = computed(() => statFoldAt(tribTargetMajor.value) < 1)

  /** 渡劫账实际读数;恢复与开劫护持须走 sustainScore / guardScore(铁躯、逆流会打折),不取词条原值 */
  const tribLedger = computed(() => {
    const mods = player.finalStats.mods
    const stat = currentStatGuard()
    const def = tribPlan.value?.def
    const relief = def ? currentTribulationRelief(def.id) : undefined
    // 封顶与折算同 waveDamage:减伤 0.6、抗性 0.8、灵根 reductionToResist
    const reduction = tribReduction(mods)
    // 濒危减伤(背水/涅槃词条):气血垂危时按同款封顶再削,账上须列出
    const lowHpReduction = tribLowHpReduction(mods)
    return {
      resist: currentTribResist(mods, relief, stat),
      statResist: stat.resist,
      reduction,
      lowHpReduction,
      sustain: def ? sustainScore(mods, def, relief) : 0,
      guard: (def ? guardScore(mods, def, relief) : 0) + stat.guard,
      statGuard: stat.guard
    }
  })

  /** 天威(道数 + 单波区间),与结算同一批函数;须乘入今日 tribulationMult,与劫势 verdict 一致 */
  const tribWeather = computed(() => todayWeather())
  const tribWeatherLine = computed(() => weatherTribulationLine(tribWeather.value))
  const tribWave = computed(() =>
    tribPlan.value
      ? tribulationWaveSpan(tribPlan.value.def, tribTargetMajor.value, tribWeather.value.tribulationMult)
      : null
  )

  /** 与此劫气机相应的灵根;判据取自 tribulationRelief,与结算同源 */
  const reliefRoots = computed(() =>
    tribPlan.value ? reliefElements(rootElements(player.linggen?.roots), tribPlan.value.kind) : []
  )

  return { PLAN_COLOR, tribPlan, tribTargetMajor, worldStep, tribLedger, tribWeather, tribWeatherLine, tribWave, reliefRoots }
}
