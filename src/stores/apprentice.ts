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
import { useAuthStore } from '@/stores/auth'
import { cloudApi } from '@/services/cloud'
import { herbGradeOfMajor } from '@/data/herbGrades'
import { MAX_MAJOR } from '@/data/realms'
import {
  APPRENTICE_MAX_LEVEL,
  APPRENTICES,
  BOND_TITLES,
  STARTER_APPRENTICE,
  apprenticeDef,
  apprenticeSlots,
  APPRENTICE_SLOT_HARD_CAP,
  taskDef,
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
import { reportAction, runActionAwait } from '@/core/remoteAction'

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
            const rawFinishAt = Math.floor(t.finishAt as number)
            /*
             * finishAt 不夹到 0,而是要求它**严格大于** startAt。
             *
             * 原先两处都 `Math.max(0, …)` 再判 `finishAt >= startAt`:
             * 负的 finishAt 被夹成 0,而 startAt 也被夹成 0 时 `0 >= 0` 成立,
             * 于是一条坏档里的任务变成**零时长任务** —— 开局即收割一趟。
             * 改成严格大于之后,零时长与负时长一并置闲。
             */
            /*
             * 完工时刻要有**上界**:任务最长 1 小时(见 data/apprentices 的 seconds),
             * 坏档写个一年后的 finishAt 会让这名道童**干等一年**
             * (`apprenticeService.isTaskDone` 判 `now >= finishAt`)。
             *
             * 上界以 `startAt`(任务**派发时刻**)为参照,不以「读档此刻」为参照:
             * 任务进行中把时钟往回拨,`Date.now() + 最长时长` 会缩到 finishAt 之前,
             * 那条**合法任务**就被误删了(审查意见指出的,与 regionEvent 同一个坑)。
             *
             * `startAt` 被夹成 0(坏档的负值)时它在极早的过去 —— 那时
             * `maxFinishAt` 同样极早,任务会被丢掉。那是既有用例钉住的反面,
             * 故这里给一个兜底:参照点取 `startAt` 与「读档此刻往前一个最长时长」
             * 二者的**较晚者**,既不受回拨影响,也不会因 startAt=0 而误删。
             */
            /*
             * 参照点的取法:
             *   - 正常档:用 `startAt`(派发时刻)。它不受后来回拨影响,
             *     上界即「派发 + 最长时长」—— 回拨不会把合法任务判掉。
             *   - `startAt` 被夹成 0(坏档的负值):它不代表真实派发时刻,
             *     退到「读档此刻」为参照。这条与既有用例「负 startAt 夹成 0,
             *     任务本身保留」配合 —— 坏开始时刻不该连任务一起丢。
             */
            const spanMs = (taskDef(t.spec as ApprenticeSpec).seconds + 60) * 1000
            const anchor = startAt > 0 ? startAt : Date.now()
            if (rawFinishAt > startAt && rawFinishAt <= anchor + spanMs) {
              task = { spec: t.spec, startAt, finishAt: rawFinishAt }
            }
          }
        }
        clean.push({ uid, archId, level, bond, task })
      }
      /*
       * 超量截断。
       *
       * recruit 的判据是 `apprentices.length >= apprenticeSlots(major)`,而 sanitize 原先不截断:
       * 把 apprentices 撑到上百名的坏档会被原样吃下,recruit 从此恒返 'full',
       * 玩家再也收不到道童(与「行囊已满」「灵脉容量已尽」是同一类坏档后果)。
       *
       * 上界取 apprenticeSlots 的最大值(APPRENTICE_SLOT_HARD_CAP),**不按当前境界**:
       * 按境界截会把「major=0 时留着 2~3 名」这种正常存档也削掉,
       * 而境界是可升的,读档那一刻的境界不该成为丢弟子的理由。
       */
      if (clean.length > APPRENTICE_SLOT_HARD_CAP) clean.length = APPRENTICE_SLOT_HARD_CAP
      apprentices.value = clean
    }

    /** 无弟子时送一名入门弟子,携带跨世之缘后清零 */
    function sync(): void {
      if (apprentices.value.length === 0) {
        apprentices.value = [{ uid: nextUid(), archId: STARTER_APPRENTICE, level: 1, bond: rebirthKarma.value, task: null }]
        rebirthKarma.value = 0
      }
    }

    /**
     * 收割已完工弟子,返回尾账供界面播报。
     * 登录走服务端差事账(1.74.1):开工时刻以服务端为准,收割须过「真实经过 ≥ 工期」
     * 这关,产出以服务端复算回传为准 —— 改本地时钟把差事秒完不再有用。服务端拒了
     * 分三种处置(1.74.1 修「卡在约剩 00分00秒」):
     *  · gone(云端查无此账:存量任务/他端已收)—— 作废这单,道童回闲。这单永远收不回,
     *    不清就是一张倒计时停死在 00:00 的卡。
     *  · remainMs(尚在差中:本机钟比服务端快)—— 按服务端口径校准 finishAt,倒计时恢复走动。
     *  · 其余(网络/服务异常/旧版服务端不认这两个字段)—— 不收不清,但记下首败时刻:
     *    **同一条完工未收满 60 秒即作废放人**(不给产出)。作废不发放任何资源,反作弊面
     *    丝毫无损;而「永远等下去」换来的只是一张死卡 —— 网络、部署错位、新旧版本混跑,
     *    任何一种都能把「等」变成「永远等」。
     * 失败后冷却 3 秒,免得界面每秒一发空请求。
     */
    let claimCooldownUntil = 0
    /** 完工却屡收不回的弟子:uid → 首次收割失败的时刻;收成落袋/校准/派新活即除名 */
    const stuckSince = new Map<string, number>()
    /** 完工未收的等待上限:超过它宁可作废这单(不发放),也不让道童永远钉在 00:00 */
    const STUCK_VOID_MS = 60_000
    /** 服务端代派对齐的上次时刻:30 秒一次足够,省得每轮收割都拉一遍清单 */
    let reconciledAt = 0
    /**
     * 服务端代派的差事认领回本地(1.74.5):离线托管由服务端按「各尽其长」派出的单,
     * 本地账里没有(task 为 null)—— 归来先把在途清单对齐到本地,随后的收割才认得它们。
     * 本地已有任务的(自己派的)不动;清单里没有而本地有的,由收割的 gone 分支作废。
     */
    async function reconcileServerTasks(): Promise<void> {
      if (!useAuthStore().loggedIn) return
      const now = Date.now()
      if (now - reconciledAt < 30_000) return
      reconciledAt = now
      try {
        const r = await cloudApi.apprenticeTaskList()
        for (const row of r.tasks) {
          const appr = apprentices.value.find(x => x.uid === row.uid)
          if (!appr || appr.task) continue
          const spec = isSpec(row.spec) ? row.spec : null
          if (spec === null || !(row.seconds > 0)) continue
          appr.task = { spec, startAt: row.startedAt, finishAt: row.startedAt + row.seconds * 1000 }
        }
      } catch {
        // 云不可达:下次收割再对齐,不影响本地已派的单
      }
    }
    async function collectFinished(now: number, major: number): Promise<TaskSpoils[]> {
      if (!validNow(now)) return []
      const auth = useAuthStore()
      const reaped: TaskSpoils[] = []
      if (auth.loggedIn && now < claimCooldownUntil) return []
      // 先对齐服务端代派的单再收割:离线托管派出的差事,本地账里原本没有
      if (auth.loggedIn) await reconcileServerTasks()
      let claimFailed = false
      for (const appr of apprentices.value) {
        if (!taskDone(appr, now)) {
          // 没完工(含校准后的新完工时刻):不再处于「收不回」的僵局
          stuckSince.delete(appr.uid)
          continue
        }
        const spec = appr.task!.spec
        let spoils: TaskSpoils
        if (auth.loggedIn) {
          /*
           * 收割整笔交给服务端(1.79.0):产出、升级、缘分都在云档上落,
           * 本地只按回话更新这一位的显示。原先本地记账 —— 抛弃存档之后那笔账传不上去,
           * 等于白派一趟。
           */
          const r = await runActionAwait<{ spoils?: TaskSpoils; remainMs?: number; gone?: boolean }>(
            'apprentice_claim',
            { id: appr.uid }
          )
          const out = r.ok ? r.value : null
          if (out?.spoils) {
            stuckSince.delete(appr.uid)
            spoils = out.spoils
          } else if (out?.gone) {
            stuckSince.delete(appr.uid)
            appr.task = null
            continue
          } else if (typeof out?.remainMs === 'number' && Number.isFinite(out.remainMs) && out.remainMs >= 0 && appr.task) {
            // 校准 +250ms 缓冲:remainMs 是服务端此刻的余量,取回与写回之间又流走了一点
            stuckSince.delete(appr.uid)
            appr.task.finishAt = now + out.remainMs + 250
            claimFailed = true
            continue
          } else if (voidIfStuck(appr, now)) {
            continue
          } else {
            claimFailed = true
            continue
          }
        } else {
          spoils = apprenticeSpoils(appr.archId, spec, major, appr.level)
        }
        applySpoils(spoils, major)
        appr.level = Math.min(APPRENTICE_MAX_LEVEL, appr.level + 1)
        appr.bond += 1
        appr.task = null
        reaped.push(spoils)
      }
      if (claimFailed) claimCooldownUntil = now + 3000
      return reaped
    }

    /**
     * 完工却屡收不回:首败记时刻,等满 60 秒作废放人(不发放,道童回闲)。
     * 返回 true 表示这次已作废,调用方直接 continue。
     */
    function voidIfStuck(appr: OwnedApprentice, now: number): boolean {
      const since = stuckSince.get(appr.uid)
      if (since === undefined || now - since < STUCK_VOID_MS) {
        if (since === undefined) stuckSince.set(appr.uid, now)
        return false
      }
      stuckSince.delete(appr.uid)
      appr.task = null
      return true
    }

    /** 派一名闲置弟子跑一趟;登录先入服务端差事账,入账不成不派(宁可白点一次) */
    async function dispatch(uid: string, spec: ApprenticeSpec, now: number): Promise<boolean> {
      if (!isSpec(spec) || !validNow(now)) return false
      const appr = apprentices.value.find(x => x.uid === uid)
      if (!appr || appr.task) return false
      if (useAuthStore().loggedIn) {
        try {
          await cloudApi.apprenticeTaskStart({
            uid,
            archId: appr.archId,
            spec,
            level: appr.level,
            major: usePlayerStore().major
          })
        } catch {
          return false
        }
      }
      appr.task = { spec, startAt: now, finishAt: now + apprenticeTaskSeconds(spec) * 1000 }
      stuckSince.delete(uid)
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
      // 1.79.0:招募由服务端在云档上重跑一次(扣灵石、签发道童都算那一侧),本地这次只是预测
      reportAction('apprentice_recruit')
      return 'ok'
    }

    /** 一键「各尽其长」:闲置道童派往当前最缺的门;返回派出人数 */
    async function dispatchAll(now: number): Promise<number> {
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
      let sent = 0
      for (const t of targets) {
        if (await dispatch(t.uid, t.spec, now)) sent += 1
      }
      return sent
    }

    /** 转世清零,新世由 sync() 补送 starter;最高羁绊达真传者凝成跨世之缘(封顶真传阈值) */
    function resetForRebirth(): void {
      let max = 0
      for (const appr of apprentices.value) max = Math.max(max, appr.bond)
      rebirthKarma.value = max >= REBIRTH_KARMA_CAP ? REBIRTH_KARMA_CAP : 0
      apprentices.value = []
      stuckSince.clear()
    }

    /**
     * 把一趟差事的产出记进账。
     *
     * 1.79.0 起服务端也要用这一份(差事收割由动作结算在云档上重跑),
     * 所以从模块级私有函数提到 store 方法上 —— 两处各写一遍必然漂移。
     */
    function applyTaskSpoils(spoils: TaskSpoils, major: number): void {
      applySpoils(spoils, major)
    }

    return { apprentices, rebirthKarma, sanitize, sync, collectFinished, dispatch, dispatchAll, resetForRebirth, recruit, applyTaskSpoils }
  },
  { persist: persistConfig('apprentice') }
)
