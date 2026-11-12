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
import { daoluDef } from '@/data/daolu'
import { asFiniteNumber, asNumberRecord, asObjectOrNull, asRecord, asStringArray } from '@/utils/saveShape'

/**
 * 计数器与日课基线的读档上界。
 *
 * 这两处都是**判定依据**(成就 `counter >= value`、日课 `counters - base`),
 * 不只是显示值。单局几千场已是长线,真实可达到的计数远低于一亿。
 */
const COUNTER_MAX = 100_000_000

export type CollectionCategory = 'equip' | 'gongfa' | 'pill' | 'artifact' | 'pet' | 'event' | 'talent' | 'daolu'

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
      talent: [],
      // 人缘:历世遇见过的道侣。道侣这一世只遇一位,跨世累积才看得出「我都遇过谁」
      daolu: []
    })
    /** 图鉴收录时刻,键为 `${category}:${id}`(旧档已收录条目无记录) */
    const collectedAt = ref<Record<string, number>>({})
    /** 成就达成时刻,键为成就 id */
    const achievedAt = ref<Record<string, number>>({})

    /** 存档修复:计数/图鉴表写坏会让成就判定与图鉴页在渲染期抛错 */
    function sanitize(): void {
      /*
       * 计数器是**成就/任务/日课三处的判定依据**,不只是显示值。
       *
       * `asNumberRecord` 只挡非有限值与负数,不管上界 —— 坏档写 `kills: 1e300`
       * 会原样留下,而 `evalCond` 的判据是 `counter(key) >= cond.value`,
       * 于是**一次解锁全部计数类成就**(实测 5 个),日课也一并判为达成。
       * 上界取一亿,超出**归零而不是夹到上界**:夹到一亿仍然是「远超所有成就阈值」的
       * 合法读数,判据照样全过 —— 归零才表达「这条读数不可信」。
       * (同理见 `inventory` 的 `investedDust`;与「夹到边界」那种修法区分开:
       * 夹的值本身可信、只是越界,归零的是值本身不可信。)
       */
      counters.value = Object.fromEntries(
        Object.entries(asNumberRecord(counters.value, 0)).map(([k, v]) => [k, v > COUNTER_MAX ? 0 : v])
      )
      // 成就是集合语义:与 unlockAchievement 同口径去重;只留认得的 id(野 id 画不出来却照样计数)
      const achievementIds = new Set(ACHIEVEMENTS.map(a => a.id))
      const achievedSet = new Set(asStringArray(achieved.value).filter(id => achievementIds.has(id)))
      achieved.value = [...achievedSet]
      const maxIdx = Math.max(0, MAIN_QUESTS.length - 1)
      mainIdx.value = Math.min(Math.floor(asFiniteNumber(mainIdx.value, 0, 0)), maxIdx)
      const d = asObjectOrNull<{ date?: unknown; base?: unknown; done?: unknown }>(daily.value)
      const base = asNumberRecord(d?.base, 0)
      /*
       * 日课基线缺失时的兜底:把当前累计当作基线。
       *
       * dailyDelta = counters - base。base 被读成空记录(坏档、手改、字段改名)
       * 而 date 恰好还是今天时,delta 就等于**历史累计** —— 实测 counters.kills=500、
       * base={} 时 delta 是 500,于是 checkDaily 一开局就把所有日课判为达成,
       * 白送全天奖励并刷一串 toast。
       *
       * 归零(delta=0)与抄成当前累计是同一个效果,但后备语义更清楚:
       * 「今天从此刻开始算」,而不是「从 0 起算」;后备基线不夹上界(抄当前累计本就自洽)。
       *
       * 基线本身也要设上界 —— 它与 `counters` 是同一类**判定依据**。
       * 只看「有没有键」不够:坏档写 `base.kills: 1e300` 时,delta 恒为极大的负数,
       * 日课**永远做不完**(实测 `dailyDelta` 得 -1e300)。
       * 巨值按「基线缺失」处理 —— 回落到当前累计,即「今天从此刻开始算」,
       * 与上面那条兜底同一个语义;归零反而会让 delta 变成历史累计,正是要避免的白送。
       */
      const hasBase =
        Object.keys(base).length > 0 && !Object.values(base).some(v => v > COUNTER_MAX)
      const dailyTaskIds = new Set(DAILY_TASKS.map(t => t.id))
      daily.value = {
        date: typeof d?.date === 'string' ? d.date : '',
        base: hasBase ? base : { ...counters.value },
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
        talent: (id: string) => talentDef(id) !== undefined,
        daolu: (id: string) => daoluDef(id) !== undefined
      } satisfies Record<CollectionCategory, (id: string) => boolean>
      collections.value = {
        equip: [...new Set(asStringArray(cats.equip))].filter(knownFns.equip),
        gongfa: [...new Set(asStringArray(cats.gongfa))].filter(knownFns.gongfa),
        pill: [...new Set(asStringArray(cats.pill))].filter(knownFns.pill),
        artifact: [...new Set(asStringArray(cats.artifact))].filter(knownFns.artifact),
        pet: [...new Set(asStringArray(cats.pet))].filter(knownFns.pet),
        event: [...new Set(asStringArray(cats.event))].filter(knownFns.event),
        talent: [...new Set(asStringArray(cats.talent))].filter(knownFns.talent),
        // 旧档没有这一栏:asStringArray(undefined) 得空数组,自动补上
        daolu: [...new Set(asStringArray(cats.daolu))].filter(knownFns.daolu)
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
