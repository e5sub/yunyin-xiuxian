/** GameEngine 游戏心跳:推进均基于时间戳差值,切后台/休眠/关闭不丢进度 */
import { gn, mulN } from '@/utils/gnum'
import {
  ACTIVE_STAMP_MS,
  AGE_YEARS_PER_HOUR,
  OFFLINE_MIN_SECONDS,
  OFFLINE_MODAL_MIN_SECONDS,
  TICK_MS
} from '@/data/constants'
import { buffDef } from '@/data/buffs'
import { cloudApi } from '@/services/cloud'
import { useAuthStore } from '@/stores/auth'
import { useGameStore } from '@/stores/game'
import { usePlayerStore } from '@/stores/player'
import { useResourcesStore } from '@/stores/resources'
import { useDongfuStore } from '@/stores/dongfu'
import { useCultivationStore } from '@/stores/cultivation'
import { useAdventureStore } from '@/stores/adventure'
import { useInventoryStore } from '@/stores/inventory'
import { useQuestsStore } from '@/stores/quests'
import { useSettingsStore } from '@/stores/settings'
import { useLoadoutsStore } from '@/stores/loadouts'
import { useEndgameStore } from '@/stores/endgame'
import { useLoreStore } from '@/stores/lore'
import { useMarketStore } from '@/stores/market'
import { useApprenticeStore } from '@/stores/apprentice'
import { useBountyStore } from '@/stores/bounty'
import { useDiagStore } from '@/stores/diag'
import { usePacingTelemetry } from '@/stores/pacingTelemetry'
import { useUiStore } from '@/stores/ui'
import { advanceOnStores } from './advanceResolve'
import { tickExploration, stopExploration } from './exploration'
import { settleOffline, sanitizeOfflineInputs } from './offline'
import { checkStateAchievements, rolloverDailyIfNeeded } from './progress'
import { mayTriggerEnlightenment, mayTriggerCaveEvent } from './earlyGameService'
import { settleSuppressedRegions } from './suppress'
import { studyTick, seedLoreIfNeeded } from './loreService'
import { flushSaveWrites } from '@/utils/storage'
import { enginePaused, pauseElapsedMs, setEnginePaused } from './enginePause'
import { shiftEarlyGameWindows } from './earlyGameService'
import { noteSrvClock, srvNow } from './srvClock'

const PERIODIC_CHECK_SEC = 30

/** 登录态心跳间隔(秒):服务端权威推进的对账节奏;服务端限速 2 秒,5 秒不撞 */
const HEARTBEAT_SEC = 5
/**
 * 战斗到点催拍的最小间隔(秒):贴着服务端 2 秒闸门,别被 429 顶回来。
 * 战斗节拍 12 秒与心跳 5 秒不同步,倒计时归零常落在两拍之间 —— 登录态本地又不打,
 * 干等下一拍心跳会晚最多 5 秒才开打(1.79.6)。到点即催,把延迟压到一拍网络往返。
 */
const BATTLE_DUE_GAP_SEC = 2.2

/** 回传分片 → store:与 core/advanceResolve 的 SLICE_FACTORIES 同一张清单(ui 不持久化,不在内) */
const SLICE_STORES: Record<string, () => unknown> = {
  game: useGameStore,
  player: usePlayerStore,
  resources: useResourcesStore,
  inventory: useInventoryStore,
  cultivation: useCultivationStore,
  dongfu: useDongfuStore,
  adventure: useAdventureStore,
  quests: useQuestsStore,
  settings: useSettingsStore,
  loadouts: useLoadoutsStore,
  endgame: useEndgameStore,
  lore: useLoreStore,
  market: useMarketStore,
  apprentice: useApprenticeStore,
  bounty: useBountyStore,
  pacing: usePacingTelemetry,
  diag: useDiagStore
}

/** 应用服务端回传的分片补丁(顶层键级):未知分片忽略 */
function applySlicesToStores(slices: Record<string, Record<string, unknown>>): void {
  for (const [id, fields] of Object.entries(slices)) {
    const factory = SLICE_STORES[id]
    if (factory === undefined) continue
    ;(factory() as { $patch: (p: unknown) => void }).$patch(fields)
  }
}

class GameEngine {
  private timer: number | undefined
  private lastTickAt = 0
  private lastStampAt = 0
  private periodicAccum = 0
  private deathAnnounced = false
  /** 心跳对账(登录态):自上次成功推进起累计的秒数与在途标记 */
  private heartAccum = 0
  private heartInFlight = false

  start(): void {
    const now = Date.now()
    const game = useGameStore()
    // 启动分段:engine.start 里的离线结算与成就补扫是进页面那块长任务的主要来源
    performance.mark('boot:engineStart')
    try {
      sanitizeOfflineInputs()
      performance.mark('boot:offlineInputs')
      // 旧存档补种:丹炉等级"能炼"的方子折算成掌握度(幂等)
      if (game.started) seedLoreIfNeeded()
      // 先翻日再结算离线:跨午夜的离线收益记入"归来之日"的日课
      rolloverDailyIfNeeded()
      if (game.started && game.lastActiveAt > 0) {
        if (useAuthStore().loggedIn) {
          // 登录态(1.75.0):离线收益由服务端按它自己的时间锚点结算,
          // 本地不再自算 —— 首拍心跳回传归来卷轴与分片补丁,簿记在落账后补做。
          void this.sendAdvance()
        } else {
          // 离线结算含装备签发,整段异步;死亡判定在其后串行(结算先加寿元,判死须用加完的数)
          void settleOffline(now).then(() => {
            if (game.started) {
              this.checkDeath()
              if (usePlayerStore().dead) {
                this.deathAnnounced = true
                useUiStore().deathDialog = true
              }
              // 补扫成就:老档/导入档未 track 过的已满足成就当场解锁
              checkStateAchievements()
            }
          })
        }
      } else if (game.started) {
        this.checkDeath()
        // 已死存档须重开轮回入口:ui.deathDialog 不持久化,不重开则低境界软锁
        if (usePlayerStore().dead) {
          this.deathAnnounced = true
          useUiStore().deathDialog = true
        }
        // 补扫成就:老档/导入档未 track 过的已满足成就当场解锁
        checkStateAchievements()
      }
      // 离线结算在本仓为异步(含装备签发),此 mark 标记「结算已发起」;
      // 成就补扫在结算回调或上方分支内完成,晚于本 mark 属预期
      performance.mark('boot:offlineSettled')
      performance.mark('boot:achievements')
    } catch (err) {
      console.error('[引擎] 离线结算异常', err)
    }
    game.stampActive(now)
    this.lastTickAt = now
    this.lastStampAt = now

    if (this.timer === undefined) {
      this.timer = window.setInterval(() => this.tickSafe(), TICK_MS)
    }
    document.addEventListener('visibilitychange', this.onVisibility)
    window.addEventListener('beforeunload', this.onUnload)
  }

  stop(): void {
    if (this.timer !== undefined) {
      window.clearInterval(this.timer)
      this.timer = undefined
    }
    document.removeEventListener('visibilitychange', this.onVisibility)
    window.removeEventListener('beforeunload', this.onUnload)
  }

  private onVisibility = (): void => {
    const game = useGameStore()
    if (document.visibilityState === 'hidden') {
      if (!enginePaused.value) game.stampActive(Date.now())
      // 盖章后须自行刷盘:storage 的 visibilitychange 监听注册更早、先于此处跑完,这次盖章会留在待刷队列
      flushSaveWrites()
    } else {
      this.tickSafe()
    }
  }

  private onUnload = (): void => {
    useGameStore().stampActive(Date.now())
    flushSaveWrites()
  }

  private tickSafe(): void {
    try {
      this.tick()
    } catch (err) {
      console.error('[引擎] Tick 异常', err)
    }
  }

  private tick(): void {
    const game = useGameStore()
    const now = Date.now()
    if (enginePaused.value) {
      this.lastTickAt = now
      return
    }
    if (!game.started) {
      this.lastTickAt = now
      return
    }
    /*
     * 时钟回拨要**重锚**,不能直接 return。
     *
     * `lastTickAt` 是上一次 tick 的时刻、`lastStampAt` 是上次记游玩时长的时刻;
     * 系统时钟往回拨之后两者都停在「未来」:
     *   · `lastTickAt` 不重锚 → `dt <= 0` 每拍都成立,引擎停摆到真实时间追平
     *     (回拨 5 分钟就停 5 分钟);修炼/灵气/寿元/历练一起冻结;
     *   · `lastStampAt` 不重锚 → `now - lastStampAt` 恒为负,`>= ACTIVE_STAMP_MS`
     *     永不成立,**游玩时长不再累计**。
     * 两者是同一件事的两半,漏一个就只修好一半。`start()` 与 `offline` 同一口径。
     */
    if (now < this.lastTickAt) this.lastTickAt = now
    if (now < this.lastStampAt) this.lastStampAt = now
    const dt = (now - this.lastTickAt) / 1000
    // 极短间隔(暂停恢复那一拍)也不推进:dt <= 0 时重锚即返回
    if (dt <= 0) {
      this.lastTickAt = now
      return
    }

    // 这一段是「后台冻结」而非在线游玩:走离线结算时不能把这整段计入游戏日,
    // 否则切后台挂机会比正常游玩更快刷过每日配额(游戏日由 totalPlaySec 推),
    // 与「关掉重开」路径(只盖章不补时长)也不一致。
    let settledOffline = false
    if (useAuthStore().loggedIn) {
      /*
       * 登录态(1.75.0):本地只做显示预测(生产数字),战斗/镇压/离线全由服务端裁决,
       * patch 回填;断网时服务端不回包,本地保持预测值,恢复后对账。
       * 顿悟与洞府巡游仍是玩家在场时的 UI 弹窗流,留在本地触发(见 advanceResolve 注释)。
       */
      void advanceOnStores(dt, now, { exploration: false, suppress: false })
        .then(() => this.checkDeath())
        .catch(() => {})
      this.heartAccum += dt
      if (dt > OFFLINE_MIN_SECONDS) {
        // 后台冻结:不本地结算,整段交给服务端按它的锚点补(立刻打一拍心跳)
        settledOffline = true
        void this.sendAdvance()
      } else if (this.heartAccum >= HEARTBEAT_SEC && !this.heartInFlight) {
        void this.sendAdvance()
      } else if (
        this.battleDueNow(now) &&
        this.heartAccum >= BATTLE_DUE_GAP_SEC &&
        !this.heartInFlight
      ) {
        // 战斗倒计时到点:不等 5 秒节拍,贴着服务端闸门催一拍(1.79.6)。
        // sendAdvance 会把 heartAccum 归零,自然形成 2.2 秒节流,不会连拍。
        void this.sendAdvance()
      }
      /*
       * 顿悟与洞府巡游改由服务端掷(1.79.0):事件本体在 player 分片里,
       * 掷签那一步在 resolveAdvanceFromSlices 里跟着生产一起跑,补丁把开着的窗带回来。
       * 客户端在这里再掷一次会与那条补丁互相覆盖,所以登录态不再本地触发。
       */
      this.periodicAccum += dt
      if (this.periodicAccum >= PERIODIC_CHECK_SEC) {
        this.periodicAccum = 0
        rolloverDailyIfNeeded()
        checkStateAchievements()
      }
    } else if (dt > OFFLINE_MIN_SECONDS) {
      // 长时间停摆(休眠/后台冻结)走离线结算;先翻日再结算,同 start。死亡判定在其后串行
      rolloverDailyIfNeeded()
      void settleOffline(now).then(() => this.checkDeath())
      settledOffline = true
    } else {
      this.advance(dt, now)
    }
    this.lastTickAt = now

    if (now - this.lastStampAt >= ACTIVE_STAMP_MS) {
      if (!settledOffline) game.addPlayTime((now - this.lastStampAt) / 1000)
      game.stampActive(now)
      this.lastStampAt = now
    }
  }

  /**
   * 历练战斗是否到点、需要催服务端打一拍(1.79.6)。
   *
   * 登录态本地不跑战斗(战斗/签发全在服务端裁决),只靠心跳驱动。战斗节拍 12 秒
   * 与心跳 5 秒互质,nextBattleAt 归零往往卡在两拍之间:玩家盯着「下一场 0 秒」
   * 却要干等最多 5 秒。这里到点即催,把等待压到一拍网络往返。
   *
   * 三个条件都必要:会话在程(否则无仗可打)、倒计时确已归零(未到点不催)、
   * 无待处理事件(事件阻塞战斗,催了服务端也让路,等事件超时自动结算那拍即可)。
   */
  private battleDueNow(_now: number): boolean {
    const adv = useAdventureStore()
    const s = adv.session
    if (!s || usePlayerStore().dead) return false
    if (adv.pendingEventId !== null) return false
    if (!Number.isFinite(s.nextBattleAt) || !Number.isFinite(s.endsAt)) return false
    /*
     * 节拍戳与服务端互认,比较须用服务端钟域(1.79.10):nextBattleAt 开局由本机盖、
     * 开打后由服务端补丁改写,而服务端按它自己的钟判到点 —— 本机钟快 S 秒时,
     * 本机钟比较会提前 S 秒「催」,催了服务端也不开打,2.2 秒一拍空转到钟差耗尽
     * (催两三拍 ≈ 5 秒,即「归零后干等」的体感)。`now` 参数留作签名兼容,比较走 srvNow()。
     */
    const at = srvNow()
    return at >= s.nextBattleAt && at < s.endsAt
  }

  /**
   * 服务端权威心跳(1.75.0):报当前修为/灵气与历练会话,应用回传分片。
   * 失败(断网/服务端不可用)留在本地预测,下一拍重试;在途标记防重入。
   */
  private async sendAdvance(): Promise<void> {
    if (this.heartInFlight) return
    this.heartInFlight = true
    this.heartAccum = 0
    try {
      const player = usePlayerStore()
      const resources = useResourcesStore()
      const adventure = useAdventureStore()
      const sentAt = Date.now()
      const r = await cloudApi.advanceGame({
        exp: { ...player.exp },
        qi: resources.qi,
        session: adventure.session
      })
      // 每拍校钟(1.79.10):回包带服务端组包时刻,叠加半程 RTT 修出钟差,
      // 催拍判定与倒计时都按服务端钟域比较,不再吃本机钟差
      noteSrvClock(r.now, Date.now() - sentAt)
      if (r.ok && r.slices !== undefined) {
        applySlicesToStores(r.slices)
        this.afterAuthorityApply()
      }
      // 归来卷轴:弹窗门槛与本地结算同一条(OFFLINE_MODAL_MIN_SECONDS),短结算只落账不打扰
      if (r.offline != null && r.offline.seconds >= OFFLINE_MODAL_MIN_SECONDS) {
        useUiStore().offlineSummary = r.offline
        this.afterAuthorityApply()
      }
    } catch {
      // 断网:留在本地预测,下一拍重试
    } finally {
      this.heartInFlight = false
    }
  }

  /** 权威分片落账后的簿记:死亡判定与成就补扫(与旧离线结算回调同口径) */
  private afterAuthorityApply(): void {
    const game = useGameStore()
    if (!game.started) return
    this.checkDeath()
    checkStateAchievements()
    if (usePlayerStore().dead) {
      this.deathAnnounced = true
      useUiStore().deathDialog = true
    }
  }

  private advance(dt: number, now: number): void {
    const player = usePlayerStore()
    const resources = useResourcesStore()
    const dongfu = useDongfuStore()
    const cultivation = useCultivationStore()

    if (!player.dead) {
      // 天时已并入 finalStats.mods,此处再乘 weatherCult/weatherQi 会重复叠加
      player.gainExp(mulN(gn(player.cultPerSec), dt))
      resources.setQi(resources.qi + player.qiRegenPerSec * dt, player.qiCapValue)
      dongfu.produce(dt)
      // 到期 Buff 须在 prune 前记下,prune 后无从得知
      const expiring = cultivation.buffs.filter(b => b.endsAt <= now)
      if (expiring.length > 0) {
        cultivation.pruneBuffs(now)
        const names = expiring.map(b => buffDef(b.defId)?.name).filter((n): n is string => n !== undefined)
        if (names.length > 0) useUiStore().toast(`「${names.join('、')}」已到期`, 'info')
      } else {
        cultivation.pruneBuffs(now)
      }
      tickExploration(now)
      mayTriggerEnlightenment()
      // 镇压收益含装备签发(异步):重入闸在 settleSuppressedRegions 内部,跳过的时长记在下一段
      void settleSuppressedRegions(dt)
      studyTick(dt)
      player.addAge((dt / 3600) * AGE_YEARS_PER_HOUR)
      this.checkDeath()
    }

    this.periodicAccum += dt
    if (this.periodicAccum >= PERIODIC_CHECK_SEC) {
      this.periodicAccum = 0
      rolloverDailyIfNeeded()
      checkStateAchievements()
      // 洞府巡游(每日一次)
      mayTriggerCaveEvent()
    }
  }

  private checkDeath(): void {
    const player = usePlayerStore()
    const adventure = useAdventureStore()
    const ui = useUiStore()
    if (player.dead || player.age < player.lifespanMax) {
      return
    }
    player.markDead()
    if (adventure.session) stopExploration('manual')
    if (!this.deathAnnounced) {
      this.deathAnnounced = true
      ui.deathDialog = true
      ui.toast('大限已至', 'warn')
    }
  }

  /** 转世后复位死亡提示 */
  resetDeathFlag(): void {
    this.deathAnnounced = false
  }

  /** 暂停心跳(如重置确认弹窗期间):不结算、不写档 */
  pause(): void {
    if (enginePaused.value) return
    useGameStore().stampActive(Date.now())
    setEnginePaused(true)
  }

  /** 恢复心跳;暂停时长补回所有按墙钟到期的状态(Buff、卦、区域事件、突破准备、历练窗口),与 gameNow() 冻结语义一致 */
  resume(): void {
    if (!enginePaused.value) return
    const now = Date.now()
    const pausedMs = pauseElapsedMs(now)
    if (pausedMs > 0) {
      useCultivationStore().shiftBuffEnds(pausedMs)
      usePlayerStore().shiftTimedState(pausedMs)
      useAdventureStore().shiftTimedState(pausedMs)
      shiftEarlyGameWindows(pausedMs)
    }
    this.lastTickAt = now
    this.lastStampAt = now
    useGameStore().stampActive(now)
    setEnginePaused(false)
  }
}

export const engine = new GameEngine()
