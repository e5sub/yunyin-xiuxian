/** 任务 / 成就 / 称号 / 图鉴 / 计数器 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { CounterKey } from '@/types'
import { persistConfig } from '@/utils/storage'
import { DAILY_TASKS, MAIN_QUESTS } from '@/data/quests'
import { ACHIEVEMENTS, titleIdsFromAchieved } from '@/data/achievements'
import { equipmentTemplate } from '@/data/equipment'
import { gongfaDef } from '@/data/gongfa'
import { pillDef } from '@/data/pills'
import { artifactDef } from '@/data/artifacts'
import { petDef } from '@/data/pets'
import { eventDef } from '@/data/events'
import { talentDef } from '@/data/talents'
import { asFiniteNumber, asNumberRecord, asObjectOrNull, asRecord, asStringArray } from '@/utils/saveShape'

export type CollectionCategory = 'equip' | 'gongfa' | 'pill' | 'artifact' | 'pet' | 'event' | 'talent'

/**
 * 计数器上界(1.59.1)。计数是终身事件数,成就/主线的门槛都在千以内;
 * 正常玩法连点一辈子也到不了 1e7(每次 +1 都是真实游戏事件),灌档的先把数压平再谈。
 * 与其「无界」,不如给个宽到不影响任何判定的硬顶:钳掉的只可能是注入值。
 */
const COUNTER_CAP = 10_000_000
/**
 * 每日基线的上界必须与计数同尺:基线是 `rolloverDaily` 时的计数快照,计数能到 1e7,
 * 基线若只给 1000,跨过 1000 的档第二次加载就会被 sanitize 钳低,
 * 「今日增量」凭空多出几千,日课一 tick 全成(1.66.1)。
 */
const DAILY_BASE_CAP = COUNTER_CAP

export const useQuestsStore = defineStore(
  'quests',
  () => {
    const counters = ref<Partial<Record<CounterKey, number>>>({})
    const achieved = ref<string[]>([])
    const mainIdx = ref(0)
    const daily = ref<{ date: string; base: Partial<Record<CounterKey, number>>; done: string[] }>({
      date: '',
      base: {},
      done: []
    })
    const titlesOwned = ref<string[]>([])
    const collections = ref<Record<CollectionCategory, string[]>>({
      equip: [],
      gongfa: [],
      pill: [],
      artifact: [],
      pet: [],
      event: [],
      talent: []
    })
    /** 图鉴收录时刻,键为 `${category}:${id}`(旧档已收录条目无记录) */
    const collectedAt = ref<Record<string, number>>({})
    /** 成就达成时刻,键为成就 id */
    const achievedAt = ref<Record<string, number>>({})

    /** 存档修复:计数/图鉴表写坏会让成就判定与图鉴页在渲染期抛错 */
    function sanitize(): void {
      // 计数钳上界:负数归零(asNumberRecord 只保形),超 1e7 的只可能是灌的
      counters.value = Object.fromEntries(
        Object.entries(asNumberRecord(counters.value, 0)).map(([k, v]) => [k, Math.min(Math.max(0, v), COUNTER_CAP)])
      )
      // 成就是集合语义:与 unlockAchievement 同口径去重;只留认得的 id(野 id 画不出来却照样计数)
      const achievementIds = new Set(ACHIEVEMENTS.map(a => a.id))
      const achievedSet = new Set(asStringArray(achieved.value).filter(id => achievementIds.has(id)))
      achieved.value = [...achievedSet]
      const maxIdx = Math.max(0, MAIN_QUESTS.length - 1)
      mainIdx.value = Math.min(Math.floor(asFiniteNumber(mainIdx.value, 0, 0)), maxIdx)
      const d = asObjectOrNull<{ date?: unknown; base?: unknown; done?: unknown }>(daily.value)
      const dailyTaskIds = new Set(DAILY_TASKS.map(t => t.id))
      daily.value = {
        date: typeof d?.date === 'string' ? d.date : '',
        base: Object.fromEntries(
          Object.entries(asNumberRecord(d?.base, 0)).map(([k, v]) => [k, Math.min(Math.max(0, v), DAILY_BASE_CAP)])
        ),
        done: [...new Set(asStringArray(d?.done))].filter(id => dailyTaskIds.has(id))
      }
      // 名号只认「已达成成就的奖励里给的那枚」:称号 mods 进 finalStats,是实打实的战力,
      // 改档塞称号(或塞一条没拿过的成就再兑称号)在这里与服务端 saveAuthority 两头被洗
      const titleIds = titleIdsFromAchieved(achievedSet)
      titlesOwned.value = [...new Set(asStringArray(titlesOwned.value))].filter(id => titleIds.has(id))
      const cats = asRecord<string[]>(collections.value)
      // 图鉴各类同为集合语义(collect 只在没有时追加):重复 id 让「已收 N」多报、灵兽册出重复 v-for key。
      // 1.59.1 起再收一道:只留认得的 def id —— 收录集从未发过奖励,但灌野 id / 灌没见过面的 id
      // 会虚抬「已收 N/总数」与图鉴完成度,白嫖收集型成就的判定素材。
      const knownFns = {
        equip: (id: string) => equipmentTemplate(id) !== undefined,
        gongfa: (id: string) => gongfaDef(id) !== undefined,
        pill: (id: string) => pillDef(id) !== undefined,
        artifact: (id: string) => artifactDef(id) !== undefined,
        pet: (id: string) => petDef(id) !== undefined,
        event: (id: string) => eventDef(id) !== undefined,
        talent: (id: string) => talentDef(id) !== undefined
      } satisfies Record<CollectionCategory, (id: string) => boolean>
      collections.value = {
        equip: [...new Set(asStringArray(cats.equip))].filter(knownFns.equip),
        gongfa: [...new Set(asStringArray(cats.gongfa))].filter(knownFns.gongfa),
        pill: [...new Set(asStringArray(cats.pill))].filter(knownFns.pill),
        artifact: [...new Set(asStringArray(cats.artifact))].filter(knownFns.artifact),
        pet: [...new Set(asStringArray(cats.pet))].filter(knownFns.pet),
        event: [...new Set(asStringArray(cats.event))].filter(knownFns.event),
        talent: [...new Set(asStringArray(cats.talent))].filter(knownFns.talent)
      }
      // 时间戳表跟着集合瘦身:收录/达成已被洗掉的条目,时刻留着只会让页面渲染出幽灵条目
      const collectedKeys = new Set(
        (Object.keys(collections.value) as CollectionCategory[]).flatMap(cat =>
          collections.value[cat].map(id => `${cat}:${id}`)
        )
      )
      collectedAt.value = Object.fromEntries(
        Object.entries(asNumberRecord(collectedAt.value, 0)).filter(([k]) => collectedKeys.has(k))
      )
      achievedAt.value = Object.fromEntries(
        Object.entries(asNumberRecord(achievedAt.value, 0)).filter(([k]) => achievedSet.has(k))
      )
    }

    const currentMainQuest = computed(() => MAIN_QUESTS[mainIdx.value])

    function counter(key: CounterKey): number {
      return counters.value[key] ?? 0
    }

    function inc(key: CounterKey, n = 1): void {
      if (!Number.isFinite(n) || n <= 0) return
      counters.value = { ...counters.value, [key]: (counters.value[key] ?? 0) + n }
    }

    function hasAchieved(id: string): boolean {
      return achieved.value.includes(id)
    }

    function unlockAchievement(id: string): boolean {
      if (achieved.value.includes(id)) return false
      achieved.value = [...achieved.value, id]
      achievedAt.value = { ...achievedAt.value, [id]: Date.now() }
      return true
    }

    function advanceMain(): void {
      const last = MAIN_QUESTS.length - 1
      if (mainIdx.value < last) mainIdx.value += 1
    }

    function ownTitle(id: string): boolean {
      if (titlesOwned.value.includes(id)) return false
      titlesOwned.value = [...titlesOwned.value, id]
      return true
    }

    function collect(category: CollectionCategory, id: string): boolean {
      const list = collections.value[category]
      if (!Array.isArray(list) || typeof id !== 'string' || id.trim() === '') return false
      if (list.includes(id)) return false
      collections.value = { ...collections.value, [category]: [...list, id] }
      collectedAt.value = { ...collectedAt.value, [`${category}:${id}`]: Date.now() }
      return true
    }

    function rolloverDaily(date: string): void {
      daily.value = { date, base: { ...counters.value }, done: [] }
    }

    function dailyDelta(key: CounterKey): number {
      return (counters.value[key] ?? 0) - (daily.value.base[key] ?? 0)
    }

    function markDailyDone(taskId: string): void {
      if (!DAILY_TASKS.some(t => t.id === taskId) || daily.value.done.includes(taskId)) return
      daily.value = { ...daily.value, done: [...daily.value.done, taskId] }
    }

    return {
      counters,
      achieved,
      mainIdx,
      daily,
      titlesOwned,
      collections,
      collectedAt,
      achievedAt,
      currentMainQuest,
      counter,
      inc,
      hasAchieved,
      unlockAchievement,
      advanceMain,
      ownTitle,
      collect,
      rolloverDaily,
      dailyDelta,
      markDailyDone,
      sanitize
    }
  },
  { persist: persistConfig('quests') }
)
