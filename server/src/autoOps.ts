/**
 * VIP 托管:设置同步 + 离线托管。
 * - 设置由客户端在变更时 PUT 上来;玩家离线时服务端按设置代打妖王(战斗本就服务端权威),
 *   所得记入台账,玩家下次上线领取。
 * - 闭关/历练的离线部分由客户端在归来结算时补推(会话/闭关跨越离线窗口),服务端不重复计。
 */
import express, { type Request, type Response } from 'express'
import { all, get, run, upsertByPk } from './db.js'
import { vipActive } from './vip.js'
import { requireAuth } from './auth.js'
import { isOnline } from './ws.js'
import { getConfigNumber } from './config.js'
import { dayKey, attemptsUsed } from './dungeonCore.js'
import { bossAttemptBonus } from './eventCore.js'
import { performStrike, ensureBoss, assessStrike, bossDifficultyOf, type BossDifficulty } from './routes/boss.js'
import { autoDonateFor } from './routes/sect.js'
import { arenaRun } from './routes/event.js'
import { activeEvent, addEventProgress, claimEvent, eventProgress, leaderboardRank, todayEvent, type EventReward } from './eventCore.js'
import { castLine, claimBasket, drawStar, leisureEnabled } from './leisureCore.js'
import { dispatchTargets, isApprenticeArch } from './apprenticeCore.js'
import { creditEventReward } from './saveCredit.js'
import { withKeyLock } from './mutex.js'

export const autoOpsRouter = express.Router()

/** 托管巡检周期:每日出剑次数有限,1 分钟一查足够 */
const JOB_TICK_MS = 60_000

/**
 * 「真的在场」的窗口:存档分片 20 秒一推,3 分钟没推过就算人不在。
 *
 * 光看 ws 连接不够 —— 手机锁屏、切走应用、浏览器冻结页面时连接可以挂着不掉,
 * 客户端那边的托管定时器却全停了。此时服务端以为「在线,客户端自己会打」而跳过,
 * 客户端又打不动,两边都不出剑:玩家挂了一夜,回来一剑没打。
 * 故在线的还要再有一条「最近仍在写档」的证据,否则照样代打。
 * 双打不会多出剑:次数是 consumeDaily 的原子占位,一天只放一剑。
 */
const ACTIVE_WINDOW_MS = 3 * 60_000

interface AutoOpsRow {
  user_id: number
  auto_boss: number
  auto_retreat: number
  auto_adventure: number
  /** 门派自动捐献:VIP 每日把名额捐完(石→铁→草) */
  auto_donate: number
  /** 每日活动托管(1.74.5):离线也由服务端代办当日额度 */
  auto_daily: number
  region_id: string
  mode: string
  boss_difficulty: string
  ledger_stone_m: number
  ledger_stone_e: number
  ledger_herb: number
  ledger_strikes: number
  ledger_tier: number
  /** 离线代办的每日活动赏台账(stone 是基础值,客户端按 ev_tier 折算) */
  ev_stone: number
  ev_herb: number
  ev_ore: number
  ev_wudao: number
  ev_dust: number
  ev_page: number
  ev_tier: number
  last_skip: string
  last_skip_at: number
}

function rowOf(userId: number): Promise<AutoOpsRow | undefined> {
  return get<AutoOpsRow>('SELECT * FROM autoops_state WHERE user_id = ?', [userId])
}

function settingsOf(r: AutoOpsRow | undefined): Record<string, unknown> {
  return {
    autoBoss: (r?.auto_boss ?? 0) === 1,
    autoRetreat: (r?.auto_retreat ?? 0) === 1,
    autoAdventure: (r?.auto_adventure ?? 0) === 1,
    autoDonate: (r?.auto_donate ?? 0) === 1,
    autoDailyEvent: (r?.auto_daily ?? 0) === 1,
    regionId: r?.region_id ?? '',
    mode: r?.mode ?? '',
    bossDifficulty: bossDifficultyOf(r?.boss_difficulty)
  }
}

/** 离线代办的每日活动赏台账(形状同 EventReward + 授予层级) */
interface EventLedger {
  stone: number
  herb: number
  ore: number
  wudao: number
  dust: number
  page: number
  tier: number
}

function eventLedgerOf(r: AutoOpsRow | undefined): EventLedger {
  return {
    stone: r?.ev_stone ?? 0,
    herb: r?.ev_herb ?? 0,
    ore: r?.ev_ore ?? 0,
    wudao: r?.ev_wudao ?? 0,
    dust: r?.ev_dust ?? 0,
    page: r?.ev_page ?? 0,
    tier: r?.ev_tier ?? 0
  }
}

function ledgerOf(r: AutoOpsRow | undefined): Record<string, unknown> {
  return {
    stoneM: r?.ledger_stone_m ?? 0,
    stoneE: r?.ledger_stone_e ?? 0,
    herb: r?.ledger_herb ?? 0,
    strikes: r?.ledger_strikes ?? 0,
    tier: r?.ledger_tier ?? 0
  }
}

/**
 * 未出剑的原因:玩家归来只看到「出剑 0 次」时,得知道是打不过、次数用尽还是妖王未生。
 * 只记最近一次,成功出剑即清空。
 */
export type SkipReason = 'hold' | 'capped' | 'boss-dead' | 'no-profile'

function skipOf(r: AutoOpsRow | undefined): { reason: string; at: number } | null {
  const reason = r?.last_skip ?? ''
  if (reason === '') return null
  return { reason, at: r?.last_skip_at ?? 0 }
}

/** 我的托管设置 + 未领取的离线讨伐所得 */
autoOpsRouter.get('/', requireAuth, (req: Request, res: Response) => {
  void (async () => {
    const r = await rowOf(req.user!.id)
    res.json({ settings: settingsOf(r), pending: ledgerOf(r), skip: skipOf(r) })
  })().catch(() => res.status(500).json({ error: '服务器异常' }))
})

/** 同步托管设置(客户端在开关变更时调用;布尔必须显式传)。
 *  台账列绝不能出现在这份写入里:离线代打的所得走 ledger 与 ev 台账列累加(creditLedger 是
 *  `ledger_herb = ledger_herb + ?` 风格),整行 REPLACE 会把玩家还没领的奖励清零 ——
 *  所以行存在时只 UPDATE 设置列,不存在才插入带零台账的完整行(1.62.0 修复)。 */
autoOpsRouter.put('/', requireAuth, (req: Request, res: Response) => {
  void (async () => {
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>
    const b = (v: unknown): boolean => v === true
    const s = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '')
    const settings = {
      auto_boss: b(body.autoBoss) ? 1 : 0,
      auto_retreat: b(body.autoRetreat) ? 1 : 0,
      auto_adventure: b(body.autoAdventure) ? 1 : 0,
      auto_donate: b(body.autoDonate) ? 1 : 0,
      auto_daily: b(body.autoDailyEvent) ? 1 : 0,
      region_id: s(body.regionId, 64),
      mode: s(body.mode, 16),
      boss_difficulty: bossDifficultyOf(body.bossDifficulty),
      updated_at: Date.now()
    }
    const existing = await rowOf(req.user!.id)
    if (existing === undefined) {
      await upsertByPk('autoops_state', {
        user_id: req.user!.id,
        ...settings,
        ledger_stone_m: 0,
        ledger_stone_e: 0,
        ledger_herb: 0,
        ledger_strikes: 0,
        ledger_tier: 0,
        ev_stone: 0,
        ev_herb: 0,
        ev_ore: 0,
        ev_wudao: 0,
        ev_dust: 0,
        ev_page: 0,
        ev_tier: 0
      })
    } else {
      await run(
        `UPDATE autoops_state
         SET auto_boss = ?, auto_retreat = ?, auto_adventure = ?, auto_donate = ?, auto_daily = ?, region_id = ?, mode = ?, boss_difficulty = ?, updated_at = ?
         WHERE user_id = ?`,
        [
          settings.auto_boss,
          settings.auto_retreat,
          settings.auto_adventure,
          settings.auto_donate,
          settings.auto_daily,
          settings.region_id,
          settings.mode,
          settings.boss_difficulty,
          settings.updated_at,
          req.user!.id
        ]
      )
    }
    res.json({ ok: true })
  })().catch(() => res.status(500).json({ error: '服务器异常' }))
})

/**
 * 领取离线讨伐所得:返回台账并清零。
 *
 * 只认「出剑次数」清账:出剑自 1.62.0 起就无资粮,台账里那三列 stone/herb 恒为 0
 * (performStrike 的 reward 字段是历史遗留,固定 `{ stone: 0, herb: 0 }`)。
 * 真正的所得是击杀赏,走 boss_loot 台账由客户端领取,不在这里。
 * 之所以还回这三列:老客户端会读,给个 0 比给 undefined 安全。
 */
autoOpsRouter.post('/collect', requireAuth, (req: Request, res: Response) => {
  /*
   * 领取须串行(1.79.15):「读台账 → 落档 → 清零」三步之间有 await,两个并发请求
   * (连点领取/双标签页)会各读到同一份 ev 台账、各落一次档 —— 1.79.12 前这不是钱
   * (客户端本地加的那份会被心跳顶回),现在落档即真金。锁序 autoops:<uid> → save:<uid>
   * 单向(creditEventReward 内部拿 save 锁),与 boss /claim 的 boss_loot:<uid> 同款。
   */
  void withKeyLock(`autoops:${req.user!.id}`, async () => {
    const r = await rowOf(req.user!.id)
    const pending = ledgerOf(r)
    const events = eventLedgerOf(r)
    const skip = skipOf(r)
    if (r !== undefined && (r.ledger_strikes > 0 || events.stone > 0 || events.herb > 0 || events.ore > 0 || events.wudao > 0 || events.dust > 0 || events.page > 0)) {
      /*
       * ev 台账落档(1.79.12):离线代办的每日活动赏在清零前直接写进云档 resources,
       * 灵石按**授予时**的层级折(ev_tier)。此前只回数值让客户端本地加 —— 抛弃存档
       * 之后被心跳补丁一拍顶回,赏格蒸发而台账已清零,连重领都没有。
       * 1.79.18:落档成功才清账(与 boss /claim 同一范式) —— 此前 .catch(() => undefined)
       * 把落档失败吞掉后仍无条件清零,抖动一次这笔赏就永久蒸发且无重领入口。
       */
      const tier = Math.max(0, Math.trunc(events.tier))
      const credited = await creditEventReward(
        req.user!.id,
        {
          stone: events.stone > 0 ? events.stone : undefined,
          herb: events.herb > 0 ? events.herb : undefined,
          ore: events.ore > 0 ? events.ore : undefined,
          wudao: events.wudao > 0 ? events.wudao : undefined,
          dust: events.dust > 0 ? events.dust : undefined,
          page: events.page > 0 ? events.page : undefined
        },
        tier
      ).catch(() => false)
      if (credited) {
        await run(
          'UPDATE autoops_state SET ledger_stone_m = 0, ledger_stone_e = 0, ledger_herb = 0, ledger_strikes = 0, ledger_tier = 0, ev_stone = 0, ev_herb = 0, ev_ore = 0, ev_wudao = 0, ev_dust = 0, ev_page = 0, ev_tier = 0 WHERE user_id = ?',
          [req.user!.id]
        )
      }
    }
    return { collected: { ...pending, events }, skip }
  })
    .then(collected => {
      res.json(collected)
    })
    .catch(() => res.status(500).json({ error: '服务器异常' }))
})

/* ---------------- 离线托管任务 ---------------- */

/** 最近是否还在写档(REST/在线判定之外的第二条在场证据,见 ACTIVE_WINDOW_MS) */
async function recentlySynced(userId: number): Promise<boolean> {
  const row = await get<{ updated_at: number }>('SELECT updated_at FROM saves WHERE user_id = ?', [userId])
  if (row === undefined) return false
  return Date.now() - (row.updated_at ?? 0) <= ACTIVE_WINDOW_MS
}

/** 记「这一轮没打成」的原因;成功出剑时清空 */
async function noteSkip(userId: number, reason: SkipReason | ''): Promise<void> {
  await run('UPDATE autoops_state SET last_skip = ?, last_skip_at = ? WHERE user_id = ?', [
    reason,
    reason === '' ? 0 : Date.now(),
    userId
  ]).catch(() => undefined)
}

/**
 * 给台账记账。
 *
 * 只记剑数与层级:出剑无资粮(1.62.0 起击杀赏才发,走 boss_loot),原先这里还按
 * performStrike 的 reward 累加 stone/herb,而那个字段恒为 `{0,0}` —— 台账三列因此永远是 0,
 * 客户端领的时候却照着它折出「灵石 +0」报给玩家。层级留着:击杀赏在客户端按自身境界折算,
 * 归来时境界已变,得知道当时是按哪一层记的。
 */
async function creditLedger(userId: number, tier: number): Promise<void> {
  const r = await rowOf(userId)
  if (r === undefined) return
  await run(
    'UPDATE autoops_state SET ledger_strikes = ledger_strikes + 1, ledger_tier = ?, last_skip = ?, last_skip_at = 0 WHERE user_id = ?',
    [tier, '', userId]
  )
}

/**
 * 一轮巡检:为离线 VIP 道友代打妖王(每人每轮至多一剑,次数与存活校验同在线同路)。
 *
 * 「离线」= 没有连接,或虽有连接但三分钟没写过档(挂着但页面被冻结)。
 * 每次跳过都留个原因,玩家归来才知道昨天为什么一剑没打。
 */
async function tickOfflineBoss(): Promise<void> {
  const rows = await all<AutoOpsRow>('SELECT * FROM autoops_state WHERE auto_boss = 1')
  for (const r of rows) {
    try {
      // 真在场(连着且还在写档)的由客户端 autoOps 自己打;服务端只补没人的那段
      if (isOnline(r.user_id) && (await recentlySynced(r.user_id))) continue
      if (!(await vipActive(r.user_id))) continue
      // 没进过游戏(无档案快照)的没法代打
      const profile = await get<{ atk_m: number }>('SELECT atk_m FROM profiles WHERE user_id = ?', [r.user_id])
      if (profile === undefined) {
        await noteSkip(r.user_id, 'no-profile')
        continue
      }
      // 顺带补重生:无人在线时妖王也按重生期回来,离线道友照常可讨
      const boss = await ensureBoss()
      if (boss.dead_at !== 0) {
        await noteSkip(r.user_id, 'boss-dead')
        continue
      }
      const limit = (await getConfigNumber('boss_daily_attempts', 1)) + (await bossAttemptBonus())
      if ((await attemptsUsed(r.user_id, 'boss', dayKey())) >= limit) {
        await noteSkip(r.user_id, 'capped')
        continue
      }
      // 量力而行:能补刀先补刀,站得住就砍;明显打不过则蓄势留剑(次数不过期,临期兜底)
      const difficulty: BossDifficulty = bossDifficultyOf(r.boss_difficulty)
      const assess = await assessStrike(r.user_id, boss, difficulty)
      if (!assess.worthIt) {
        // last-call(临近日终)时 assess 已放行,这里只剩「真打不过」
        await noteSkip(r.user_id, assess.reason === 'no-profile' ? 'no-profile' : 'hold')
        continue
      }

      const out = await performStrike(r.user_id, difficulty)
      await creditLedger(r.user_id, out.tier)
    } catch {
      // 单人失败不影响其余道友
    }
  }
}

/**
 * 一轮巡检:门派自动捐献。
 *
 * 只看开关与 VIP —— 不看在线:捐献是纯服务端账(额度、余额、门派库都在服务端),
 * 玩家挂着不动也该捐。日界一到,第一名巡检进来的人把当日名额捐满,之后每分钟的重扫
 * 会被 autoDonateFor 的锁外粗筛挡掉(只读一行成员记录)。
 */
async function tickAutoDonate(): Promise<void> {
  const rows = await all<{ user_id: number }>('SELECT user_id FROM autoops_state WHERE auto_donate = 1')
  for (const r of rows) {
    try {
      if (!(await vipActive(r.user_id))) continue
      await autoDonateFor(r.user_id)
    } catch {
      // 单人的账出错不影响其余道友
    }
  }
}

/* ---------------- 每日活动离线代办(1.74.5) ---------------- */

/** 把一份赏记进每日活动台账(SQL 侧累加,并发安全);tier 取授予时的境界层级 */
async function creditEventLedger(userId: number, reward: EventReward, tier: number): Promise<void> {
  await run(
    `UPDATE autoops_state
     SET ev_stone = ev_stone + ?, ev_herb = ev_herb + ?, ev_ore = ev_ore + ?, ev_wudao = ev_wudao + ?, ev_dust = ev_dust + ?, ev_page = ev_page + ?, ev_tier = ?
     WHERE user_id = ?`,
    [reward.stone, reward.herb, reward.ore, reward.wudao, reward.dust, reward.page, tier, userId]
  ).catch(() => undefined)
}

/** 授予时层级:灵石按授予时的境界折,归来时境界变了也不漂(与 boss 台账 ledger_tier 同思路) */
async function realmTierOf(userId: number): Promise<number> {
  const row = await get<{ realm_index: number }>('SELECT realm_index FROM profiles WHERE user_id = ?', [userId])
  return Math.max(0, Math.trunc(row?.realm_index ?? 0))
}

/**
 * 一轮巡检:离线 VIP 道友的「自动做每日活动」。
 *
 * 客户端在场时它自己每分钟办一遍,这里只补没人的那段(与代打妖王同一个在场判据)。
 * 逐项口径与客户端 autoOps 的 autoSevenDay/autoLeisure 一致:
 *   · 擂台:未达标就代连战(raise 只升不降,重复跑不亏);
 *   · 妖潮夜:出剑是 autoBoss 的事,这里只在达标后领赏;
 *   · 天榜:名次达标补满进度即领;
 *   · 切磋/秘境:要玩家本人拍板,不代做;
 *   · 观星:一日一签,抽过即回看;
 *   · 垂钓:竿竿钓满再收篓。
 * 所得全部进 ev_* 台账,玩家归来随 /collect 一并领走 —— 与在线托管同等待遇。
 */
async function tickAutoDaily(): Promise<void> {
  const rows = await all<{ user_id: number }>('SELECT user_id FROM autoops_state WHERE auto_daily = 1')
  for (const r of rows) {
    try {
      if (isOnline(r.user_id) && (await recentlySynced(r.user_id))) continue
      if (!(await vipActive(r.user_id))) continue
      const tier = await realmTierOf(r.user_id)
      /* ---- 周天七会 ---- */
      const { day, event } = todayEvent()
      if (await activeEvent()) {
        const mine = await eventProgress(r.user_id, day, event.id)
        if (!mine.claimed) {
          if (event.kind === 'arena') {
            if (mine.progress < event.target) await arenaRun(r.user_id)
            const after = await eventProgress(r.user_id, day, event.id)
            if (after.progress >= event.target && !after.claimed) {
              const reward = await claimEvent(r.user_id, day, event.id)
              if (reward !== null) await creditEventLedger(r.user_id, reward, tier)
            }
          } else if (event.kind === 'boss') {
            // 出剑由 tickOfflineBoss 负责;这边只把达标的赏领走
            if (mine.progress >= event.target) {
              const reward = await claimEvent(r.user_id, day, event.id)
              if (reward !== null) await creditEventLedger(r.user_id, reward, tier)
            }
          } else if (event.kind === 'board') {
            const rank = await leaderboardRank(r.user_id)
            if (rank !== null && rank <= event.target) {
              await addEventProgress(r.user_id, day, event.id, event.target)
              const reward = await claimEvent(r.user_id, day, event.id)
              if (reward !== null) await creditEventLedger(r.user_id, reward, tier)
            }
          }
          // duel / dungeon 要玩家本人挑对手与层数,离线不代做(与在线托管同口径)
        }
      }
      /* ---- 闲趣三则(猜谜一问一次、要本人作答,不代答) ---- */
      if (await leisureEnabled()) {
        const star = await drawStar(r.user_id)
        if (!star.already) await creditEventLedger(r.user_id, star.reward, tier)
        // 竿竿钓满:castLine 三竿用尽(或已收篓)返回 null
        for (let i = 0; i < 6; i += 1) {
          const cast = await castLine(r.user_id)
          if (cast === null) break
        }
        const basket = await claimBasket(r.user_id)
        if (basket !== null) await creditEventLedger(r.user_id, basket, tier)
      }
    } catch {
      // 单人失败不影响其余道友
    }
  }
}

/* ---------------- 道童差事离线派工(1.74.5) ---------------- */

/**
 * 一轮巡检:离线 VIP 道友的闲置弟子按「各尽其长」自动派差。
 *
 * 开关与客户端同源:自动历练兼管道童差事(auto_adventure),离线在线同一待遇。
 * 名册与库存读存档分片(saves.data,整片 JSON):apprentice 名册、resources/inventory 库存、
 * player 境界;派工口径吃客户端 dispatchTargetsFromStocks(vendor 单源,不另写一份规则)。
 * 只派工、不收割:产出仍由客户端归来时走 claim 复算入账(工期按服务端开工时刻,
 * 离线派出的那趟照常完工,归来即收 —— 与在线派工同一份产出)。
 * 派完即闲单清零;离线期间差事完工,下一轮巡检续派新单,与在线 10 秒一查的节奏等价。
 */
async function tickAutoApprentice(): Promise<void> {
  const rows = await all<{ user_id: number }>('SELECT user_id FROM autoops_state WHERE auto_adventure = 1')
  for (const r of rows) {
    try {
      if (isOnline(r.user_id) && (await recentlySynced(r.user_id))) continue
      if (!(await vipActive(r.user_id))) continue
      const save = await get<{ data: string }>('SELECT data FROM saves WHERE user_id = ?', [r.user_id])
      if (save === undefined) continue
      let data: Record<string, unknown>
      try {
        data = JSON.parse(save.data) as Record<string, unknown>
      } catch {
        continue
      }
      const roster = (data['apprentice'] as { apprentices?: unknown } | undefined)?.apprentices
      if (!Array.isArray(roster)) continue
      const playerSlice = data['player'] as { major?: unknown } | undefined
      const resourcesSlice = data['resources'] as { herbByGrade?: unknown; ore?: unknown; wudao?: unknown; dust?: unknown } | undefined
      const inventorySlice = data['inventory'] as { pills?: unknown } | undefined
      if (resourcesSlice === undefined) continue
      const major = Math.max(0, Math.min(40, Math.trunc(Number(playerSlice?.major ?? 0)) || 0))
      const stock = {
        herbByGrade: (resourcesSlice.herbByGrade ?? {}) as Record<string, number>,
        ore: Math.max(0, Math.trunc(Number(resourcesSlice.ore ?? 0)) || 0),
        wudao: Math.max(0, Math.trunc(Number(resourcesSlice.wudao ?? 0)) || 0),
        dust: Math.max(0, Math.trunc(Number(resourcesSlice.dust ?? 0)) || 0),
        seek: Object.values((inventorySlice?.pills ?? {}) as Record<string, number>).reduce(
          (a: number, b) => a + (Number.isFinite(b) ? Math.max(0, Math.trunc(b)) : 0),
          0
        )
      }
      // 闲置 = 本地任务为空 且 服务端无在途账(两处都查:本地档可能落后于服务端账)
      const inFlight = new Set(
        (await all<{ uid: string }>('SELECT uid FROM apprentice_tasks WHERE user_id = ?', [r.user_id])).map(x => x.uid)
      )
      const idle: Array<{ uid: string; archId: string; level: number }> = []
      for (const raw of roster) {
        const a = raw as { uid?: unknown; archId?: unknown; level?: unknown; task?: unknown }
        if (typeof a.uid !== 'string' || typeof a.archId !== 'string') continue
        if (a.task !== null && a.task !== undefined) continue
        if (inFlight.has(a.uid)) continue
        if (!(await isApprenticeArch(a.archId))) continue
        idle.push({ uid: a.uid, archId: a.archId, level: Math.max(1, Math.min(30, Math.trunc(Number(a.level ?? 1)) || 1)) })
      }
      if (idle.length === 0) continue
      const targets = await dispatchTargets(
        idle.map(x => ({ uid: x.uid, archId: x.archId })),
        stock,
        major
      )
      if (targets === null) continue
      const now = Date.now()
      for (const t of targets) {
        const own = idle.find(x => x.uid === t.uid)
        if (own === undefined) continue
        await run(
          'REPLACE INTO apprentice_tasks (user_id, uid, arch_id, spec, level, major, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [r.user_id, own.uid, own.archId, t.spec, own.level, major, now]
        )
      }
    } catch {
      // 单人失败不影响其余道友
    }
  }
}

let jobTimer: ReturnType<typeof setInterval> | undefined

/** 服务端启动时挂离线托管巡检 */
export function startAutoOpsJob(): void {
  if (jobTimer !== undefined) return
  jobTimer = setInterval(() => {
    void tickOfflineBoss().catch(() => undefined)
    void tickAutoDonate().catch(() => undefined)
    void tickAutoDaily().catch(() => undefined)
    void tickAutoApprentice().catch(() => undefined)
  }, JOB_TICK_MS)
  jobTimer.unref?.()
}
