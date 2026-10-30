/**
 * VIP 托管:设置同步 + 离线托管。
 * - 设置由客户端在变更时 PUT 上来;玩家离线时服务端按设置代打妖王(战斗本就服务端权威),
 *   所得记入台账,玩家下次上线领取。
 * - 闭关/历练的离线部分由客户端在归来结算时补推(会话/闭关跨越离线窗口),服务端不重复计。
 */
import express, { type Request, type Response } from 'express'
import { all, get, run, upsertByPk } from './db.js'
import { requireAuth } from './auth.js'
import { isOnline } from './ws.js'
import { getConfigNumber } from './config.js'
import { dayKey, attemptsUsed } from './dungeonCore.js'
import { geNorm, geAdd, type GE } from './gnum.js'
import { performStrike, ensureBoss } from './routes/boss.js'

export const autoOpsRouter = express.Router()

/** 托管巡检周期:每日出剑次数有限,1 分钟一查足够 */
const JOB_TICK_MS = 60_000

interface AutoOpsRow {
  user_id: number
  auto_boss: number
  auto_retreat: number
  auto_adventure: number
  region_id: string
  mode: string
  ledger_stone_m: number
  ledger_stone_e: number
  ledger_herb: number
  ledger_strikes: number
  ledger_tier: number
}

function rowOf(userId: number): Promise<AutoOpsRow | undefined> {
  return get<AutoOpsRow>('SELECT * FROM autoops_state WHERE user_id = ?', [userId])
}

function settingsOf(r: AutoOpsRow | undefined): Record<string, unknown> {
  return {
    autoBoss: (r?.auto_boss ?? 0) === 1,
    autoRetreat: (r?.auto_retreat ?? 0) === 1,
    autoAdventure: (r?.auto_adventure ?? 0) === 1,
    regionId: r?.region_id ?? '',
    mode: r?.mode ?? ''
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

/** 我的托管设置 + 未领取的离线讨伐所得 */
autoOpsRouter.get('/', requireAuth, (req: Request, res: Response) => {
  void (async () => {
    const r = await rowOf(req.user!.id)
    res.json({ settings: settingsOf(r), pending: ledgerOf(r) })
  })().catch(() => res.status(500).json({ error: '服务器异常' }))
})

/** 同步托管设置(客户端在开关变更时调用;布尔必须显式传) */
autoOpsRouter.put('/', requireAuth, (req: Request, res: Response) => {
  void (async () => {
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>
    const b = (v: unknown): boolean => v === true
    const s = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '')
    await upsertByPk('autoops_state', {
      user_id: req.user!.id,
      auto_boss: b(body.autoBoss) ? 1 : 0,
      auto_retreat: b(body.autoRetreat) ? 1 : 0,
      auto_adventure: b(body.autoAdventure) ? 1 : 0,
      region_id: s(body.regionId, 64),
      mode: s(body.mode, 16),
      ledger_stone_m: 0,
      ledger_stone_e: 0,
      ledger_herb: 0,
      ledger_strikes: 0,
      ledger_tier: 0,
      updated_at: Date.now()
    })
    res.json({ ok: true })
  })().catch(() => res.status(500).json({ error: '服务器异常' }))
})

/** 领取离线讨伐所得:返回台账并清零 */
autoOpsRouter.post('/collect', requireAuth, (req: Request, res: Response) => {
  void (async () => {
    const r = await rowOf(req.user!.id)
    const pending = ledgerOf(r)
    if (r !== undefined && (r.ledger_strikes > 0 || r.ledger_herb > 0 || r.ledger_stone_m > 0)) {
      await run(
        'UPDATE autoops_state SET ledger_stone_m = 0, ledger_stone_e = 0, ledger_herb = 0, ledger_strikes = 0, ledger_tier = 0 WHERE user_id = ?',
        [req.user!.id]
      )
    }
    res.json({ collected: pending })
  })().catch(() => res.status(500).json({ error: '服务器异常' }))
})

/* ---------------- 离线托管任务 ---------------- */

async function vipActive(userId: number): Promise<boolean> {
  const row = await get<{ vip_until: number }>('SELECT vip_until FROM users WHERE id = ?', [userId])
  return (row?.vip_until ?? 0) > Date.now()
}

/** 给台账记账(GNum 跨指数累加在应用层做) */
async function creditLedger(userId: number, stone: GE, herb: number, tier: number): Promise<void> {
  const r = await rowOf(userId)
  if (r === undefined) return
  const next = geAdd({ m: r.ledger_stone_m, e: r.ledger_stone_e }, stone)
  await run(
    `UPDATE autoops_state
     SET ledger_stone_m = ?, ledger_stone_e = ?, ledger_herb = ledger_herb + ?, ledger_strikes = ledger_strikes + 1, ledger_tier = ?
     WHERE user_id = ?`,
    [next.m, next.e, herb, tier, userId]
  )
}

/** 一轮巡检:为离线 VIP 道友代打妖王(每人每轮至多一剑,次数与存活校验同在线同路) */
async function tickOfflineBoss(): Promise<void> {
  const rows = await all<AutoOpsRow>('SELECT * FROM autoops_state WHERE auto_boss = 1')
  for (const r of rows) {
    try {
      // 在线的由客户端 autoOps 自己打;服务端只补离线的
      if (isOnline(r.user_id)) continue
      if (!(await vipActive(r.user_id))) continue
      // 没进过游戏(无档案快照)的没法代打
      const profile = await get<{ atk_m: number }>('SELECT atk_m FROM profiles WHERE user_id = ?', [r.user_id])
      if (profile === undefined) continue
      // 顺带补重生:无人在线时妖王也按重生期回来,离线道友照常可讨
      const boss = await ensureBoss()
      if (boss.dead_at !== 0) continue
      const limit = await getConfigNumber('boss_daily_attempts', 1)
      if ((await attemptsUsed(r.user_id, 'boss', dayKey())) >= limit) continue

      const out = await performStrike(r.user_id)
      await creditLedger(r.user_id, geNorm(out.reward.stone, 0), out.reward.herb, out.tier)
    } catch {
      // 单人失败不影响其余道友
    }
  }
}

let jobTimer: ReturnType<typeof setInterval> | undefined

/** 服务端启动时挂离线托管巡检 */
export function startAutoOpsJob(): void {
  if (jobTimer !== undefined) return
  jobTimer = setInterval(() => void tickOfflineBoss().catch(() => undefined), JOB_TICK_MS)
}
