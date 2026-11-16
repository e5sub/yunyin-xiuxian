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
  region_id: string
  mode: string
  boss_difficulty: string
  ledger_stone_m: number
  ledger_stone_e: number
  ledger_herb: number
  ledger_strikes: number
  ledger_tier: number
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
    regionId: r?.region_id ?? '',
    mode: r?.mode ?? '',
    bossDifficulty: bossDifficultyOf(r?.boss_difficulty)
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
 *  台账列绝不能出现在这份写入里:离线代打的所得走 ledger_* 累加(creditLedger 是
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
        ledger_tier: 0
      })
    } else {
      await run(
        `UPDATE autoops_state
         SET auto_boss = ?, auto_retreat = ?, auto_adventure = ?, auto_donate = ?, region_id = ?, mode = ?, boss_difficulty = ?, updated_at = ?
         WHERE user_id = ?`,
        [
          settings.auto_boss,
          settings.auto_retreat,
          settings.auto_adventure,
          settings.auto_donate,
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
  void (async () => {
    const r = await rowOf(req.user!.id)
    const pending = ledgerOf(r)
    const skip = skipOf(r)
    if (r !== undefined && r.ledger_strikes > 0) {
      await run(
        'UPDATE autoops_state SET ledger_stone_m = 0, ledger_stone_e = 0, ledger_herb = 0, ledger_strikes = 0, ledger_tier = 0 WHERE user_id = ?',
        [req.user!.id]
      )
    }
    res.json({ collected: pending, skip })
  })().catch(() => res.status(500).json({ error: '服务器异常' }))
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

let jobTimer: ReturnType<typeof setInterval> | undefined

/** 服务端启动时挂离线托管巡检 */
export function startAutoOpsJob(): void {
  if (jobTimer !== undefined) return
  jobTimer = setInterval(() => {
    void tickOfflineBoss().catch(() => undefined)
    void tickAutoDonate().catch(() => undefined)
  }, JOB_TICK_MS)
  jobTimer.unref?.()
}
