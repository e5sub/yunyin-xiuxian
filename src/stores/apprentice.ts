/**
 * 收徒状态 —— 弟子与游历任务(持久化,须带 sanitize;见 storeResilience.spec)
 * 任务按墙钟:完工只看 finishAt 是否已过。产出由 apprenticeService 纯算,这里只入账。
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { persistConfig } from '@/utils/storage'
import { rng } from '@/utils/random'
import { useResourcesStore } from '@/stores/resources'
import { useInventoryStore } from '@/stores/inventory'
import { usePlayerStore } from '@/stores/player'
import { herbGradeOfMajor } from '@/data/herbGrades'
import { MAX_MAJOR } from '@/data/realms'
import {
  APPRENTICE_MAX_LEVEL,
  APPRENTICES,
  BOND_TITLES,
  STARTER_APPRENTICE,
  apprenticeDef,
  apprenticeSlots,
  type ApprenticeSpec
} from '@/data/apprentices'
import {
  apprenticeRecruitCost,
  apprenticeSpoils,
  apprenticeTaskSeconds,
  dispatchAllToNeed,
  taskDone,
  type OwnedApprentice,
  type TaskSpoils
} from '@/core/apprenticeService'
import { asArray } from '@/utils/saveShape'

let seq = 0
function nextUid(): string {
  seq += 1
  return `apt_${Date.now().toString(36)}_${seq.toString(36)}`
}

function isSpec(v: unknown): v is ApprenticeSpec {
  return v === 'herb' || v === 'ore' || v === 'adventure' || v === 'seek' || v === 'study'
}

function clampLevel(v: unknown): number {
  const n = Math.floor(Number(v) || 1)
  return Math.min(APPRENTICE_MAX_LEVEL, Math.max(1, n))
}

function clampBond(v: unknown): number {
  const n = Math.floor(Number(v) || 0)
  return Math.max(0, n)
}

/** 跨世之缘上限 = 真传(最高羁绊位阶)阈值 */
const REBIRTH_KARMA_CAP = BOND_TITLES[BOND_TITLES.length - 1]!.min

function clampKarma(v: unknown): number {
  const n = Math.floor(Number(v) || 0)
  return Math.min(REBIRTH_KARMA_CAP, Math.max(0, n))
}

/** 公共入口的境界入参:夹到真实大境界,坏数按凡境 */
function clampMajor(v: unknown): number {
  const n = Math.floor(Number(v))
  if (!Number.isFinite(n)) return 0
  return Math.min(MAX_MAJOR, Math.max(0, n))
}

/** 公共入口的墙钟(毫秒时间戳):只认有限非负数 */
function validNow(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0
}

/** 一趟产出入账;采药品阶按传入的 major 定,不另读 player */
function applySpoils(spoils: TaskSpoils, major: number): void {
  const resources = useResourcesStore()
  const inventory = useInventoryStore()
  if (spoils.herb) resources.addHerb(herbGradeOfMajor(major), spoils.herb)
  if (spoils.ore) resources.addSmall('ore', spoils.ore)
  if (spoils.dust) resources.addSmall('dust', spoils.dust)
  if (spoils.wudao) resources.addSmall('wudao', spoils.wudao)
  if (spoils.stone) resources.addStone(spoils.stone)
  if (spoils.pillId && spoils.pillCount) inventory.addPill(spoils.pillId, spoils.pillCount)
}

export const useApprenticeStore = defineStore(
  'apprentice',
  () => {
    const apprentices = ref<OwnedApprentice[]>([])
    /** 跨世之缘:真传道童转世后凝成,新世 starter 携带后清零 */
    const rebirthKarma = ref(0)

    /** 存档修复:弟子逐位修形,坏位整位丢弃;任务形状不对就当作闲置 */
    function sanitize(): void {
      rebirthKarma.value = clampKarma(rebirthKarma.value)
      const clean: OwnedApprentice[] = []
      const seenUid = new Set<string>()
      for (const raw of asArray<unknown>(apprentices.value)) {
        if (!raw || typeof raw !== 'object' || !('archId' in raw)) continue
        const archId = raw.archId
        if (typeof archId !== 'string' || !apprenticeDef(archId)) continue
        let uid = 'uid' in raw && typeof raw.uid === 'string' && raw.uid ? raw.uid : nextUid()
        // uid 须唯一(派活 / 收割按 uid 认人);重号的弟子重排新号,不丢弃
        while (seenUid.has(uid)) uid = nextUid()
        seenUid.add(uid)
        const level = clampLevel('level' in raw ? raw.level : 1)
        const bond = clampBond('bond' in raw ? raw.bond : 0)
        let task: OwnedApprentice['task'] = null
        if ('task' in raw && raw.task && typeof raw.task === 'object') {
          const t = raw.task as { spec?: unknown; startAt?: unknown; finishAt?: unknown }
          if (isSpec(t.spec) && Number.isFinite(t.startAt) && Number.isFinite(t.finishAt)) {
            const startAt = Math.max(0, Math.floor(t.startAt as number))
            const finishAt = Math.max(0, Math.floor(t.finishAt as number))
            // finishAt < startAt 会开局即收割一趟,视作坏任务置闲
            if (finishAt >= startAt) task = { spec: t.spec, startAt, finishAt }
          }
        }
        clean.push({ uid, archId, level, bond, task })
      }
      apprentices.value = clean
    }

    /** 无弟子时送一名入门弟子,携带跨世之缘后清零 */
    function sync(): void {
      if (apprentices.value.length === 0) {
        apprentices.value = [{ uid: nextUid(), archId: STARTER_APPRENTICE, level: 1, bond: rebirthKarma.value, task: null }]
        rebirthKarma.value = 0
      }
    }

    /** 收割已完工弟子,返回尾账供界面播报 */
    function collectFinished(now: number, major: number): TaskSpoils[] {
      if (!validNow(now)) return []
      const reaped: TaskSpoils[] = []
      for (const appr of apprentices.value) {
        if (!taskDone(appr, now)) continue
        const spec = appr.task!.spec
        const spoils = apprenticeSpoils(appr.archId, spec, major, appr.level)
        applySpoils(spoils, major)
        appr.level = Math.min(APPRENTICE_MAX_LEVEL, appr.level + 1)
        appr.bond += 1
        appr.task = null
        reaped.push(spoils)
      }
      return reaped
    }

    /** 派一名闲置弟子跑一趟 */
    function dispatch(uid: string, spec: ApprenticeSpec, now: number): boolean {
      if (!isSpec(spec) || !validNow(now)) return false
      const appr = apprentices.value.find(x => x.uid === uid)
      if (!appr || appr.task) return false
      appr.task = { spec, startAt: now, finishAt: now + apprenticeTaskSeconds(spec) * 1000 }
      return true
    }

    /** 收一名新弟子;槽满或灵石不够则不成 */
    function recruit(major: number): 'full' | 'poor' | 'ok' {
      const safeMajor = clampMajor(major)
      if (apprentices.value.length >= apprenticeSlots(safeMajor)) return 'full'
      const owned = new Set(apprentices.value.map(a => a.archId))
      const pool = APPRENTICES.filter(x => x.id !== STARTER_APPRENTICE && !owned.has(x.id))
      if (pool.length === 0) return 'full'
      const cost = apprenticeRecruitCost(safeMajor)
      if (!useResourcesStore().spendStone(cost)) return 'poor'
      apprentices.value.push({ uid: nextUid(), archId: rng.pick(pool).id, level: 1, bond: 0, task: null })
      return 'ok'
    }

    /** 一键「各尽其长」:闲置道童派往当前最缺的门;返回派出人数 */
    function dispatchAll(now: number): number {
      if (!validNow(now)) return 0
      const idle = apprentices.value
        .filter(a => !a.task)
        .map(a => ({ uid: a.uid, talent: apprenticeDef(a.archId)!.talent }))
      if (idle.length === 0) return 0
      const resources = useResourcesStore()
      const major = usePlayerStore().major
      const targets = dispatchAllToNeed(idle, {
        herb: resources.herbOf(herbGradeOfMajor(major)),
        ore: resources.ore,
        wudao: resources.wudao,
        dust: resources.dust,
        seek: Object.values(useInventoryStore().pills).reduce((a, b) => a + b, 0)
      })
      for (const t of targets) {
        const appr = apprentices.value.find(x => x.uid === t.uid)
        if (appr && !appr.task) {
          appr.task = { spec: t.spec, startAt: now, finishAt: now + apprenticeTaskSeconds(t.spec) * 1000 }
        }
      }
      return targets.length
    }

    /** 转世清零,新世由 sync() 补送 starter;最高羁绊达真传者凝成跨世之缘(封顶真传阈值) */
    function resetForRebirth(): void {
      let max = 0
      for (const appr of apprentices.value) max = Math.max(max, appr.bond)
      rebirthKarma.value = max >= REBIRTH_KARMA_CAP ? REBIRTH_KARMA_CAP : 0
      apprentices.value = []
    }

    return { apprentices, rebirthKarma, sanitize, sync, collectFinished, dispatch, dispatchAll, resetForRebirth, recruit }
  },
  { persist: persistConfig('apprentice') }
)
