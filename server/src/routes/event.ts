/**
 * 周天七会路由:今日活动、擂台连战、领赏。
 * 其余载体的进度由各自路由记账(social 切磋 / boss 出剑 / dungeon 通关),本路由只管汇总与领取。
 */
import express, { type Request, type Response } from 'express'
import { requireAuth } from '../auth.js'
import { get } from '../db.js'
import { simulateDuel, type DuelSide } from '../pvp.js'
import {
  EVENTS,
  activeEvent,
  addEventProgress,
  claimEvent,
  dayKeyOf,
  eventProgress,
  leaderboardRank,
  raiseEventProgress,
  secsToNextDay,
  todayEvent,
  type DailyEvent
} from '../eventCore.js'

export const eventRouter = express.Router()

interface ProfileRow {
  name: string
  hp_m: number
  hp_e: number
  atk_m: number
  atk_e: number
  power_m: number
  power_e: number
}

/** m×10^e 有效值 */
function mag(m: number, e: number): number {
  if (!(m > 0)) return 0
  return m * Math.pow(10, e)
}

/** 数值 → GNum(擂台对手按倍率缩放后回写) */
function toGNum(v: number): { m: number; e: number } {
  if (!(v > 0) || !Number.isFinite(v)) return { m: 0, e: 0 }
  const e = Math.floor(Math.log10(v))
  return { m: v / Math.pow(10, e), e }
}

const ARENA_FOE_NAMES = ['试剑人', '守关客', '台上老剑修']

/** 今日活动是否开启(GM 可用 event_enabled=0 全站关停) */
async function eventEnabled(): Promise<boolean> {
  return (await activeEvent()) !== null
}

function view(event: DailyEvent): DailyEvent {
  return event
}

/** 今日活动 + 我的进度 + 天榜名次 + 七日一览 */
eventRouter.get('/today', requireAuth, (req: Request, res: Response) => {
  void (async () => {
    const enabled = await eventEnabled()
    const now = Date.now()
    const { day, event } = todayEvent(now)
    const mine = await eventProgress(req.user!.id, day, event.id)
    const rank = event.kind === 'board' ? await leaderboardRank(req.user!.id) : null
    res.json({
      enabled,
      day,
      now,
      secsToNext: secsToNextDay(now),
      event: view(event),
      mine,
      rank,
      week: EVENTS.map(view)
    })
  })().catch(() => res.status(500).json({ error: '服务器异常' }))
})

/** 擂台:按自身档案生成三关对手,服务端模拟;取今日最好连胜,可反复再战 */
eventRouter.post('/arena', requireAuth, (req: Request, res: Response) => {
  void (async () => {
    const now = Date.now()
    const { day, event } = todayEvent(now)
    if (event.kind !== 'arena') {
      res.status(400).json({ error: '今日不是擂台' })
      return
    }
    if (!(await eventEnabled())) {
      res.status(404).json({ error: '今日无活动' })
      return
    }
    const me = await get<ProfileRow>(
      'SELECT name, hp_m, hp_e, atk_m, atk_e, power_m, power_e FROM profiles WHERE user_id = ?',
      [req.user!.id]
    )
    if (me === undefined) {
      res.status(400).json({ error: '自身档案未同步' })
      return
    }
    const foeMult = event.bonus?.arenaFoe ?? 1
    const selfHpMult = event.bonus?.arenaSelfHp ?? 1
    const mySide: DuelSide = {
      id: req.user!.id,
      name: me.name,
      hpM: me.hp_m * selfHpMult,
      hpE: me.hp_e,
      atkM: me.atk_m,
      atkE: me.atk_e,
      powerM: me.power_m,
      powerE: me.power_e
    }
    // 三关递增:每关对手气血 +15%、攻势 +10%,起手略低于本人(连战三场全胜约四成把握)
    const hpBase = mag(me.hp_m, me.hp_e) * 0.78 * foeMult
    const atkBase = mag(me.atk_m, me.atk_e) * 0.82 * foeMult

    const runs: { round: number; foe: string; win: boolean; rounds: number; log: string[] }[] = []
    let streak = 0
    for (let i = 0; i < event.target; i += 1) {
      const hp = toGNum(hpBase * (1 + 0.15 * i))
      const atk = toGNum(atkBase * (1 + 0.1 * i))
      const foe: DuelSide = {
        id: 0,
        name: ARENA_FOE_NAMES[i] ?? `第${i + 1}关`,
        hpM: hp.m,
        hpE: hp.e,
        atkM: atk.m,
        atkE: atk.e,
        powerM: hp.m,
        powerE: hp.e
      }
      const r = simulateDuel(mySide, foe)
      const win = r.winner === 'me'
      runs.push({ round: i + 1, foe: foe.name, win, rounds: r.rounds, log: r.log })
      if (!win) break
      streak += 1
    }
    const mine = await raiseEventProgress(req.user!.id, day, event.id, streak)
    res.json({ day, eventId: event.id, runs, streak, mine, target: event.target })
  })().catch(() => res.status(500).json({ error: '擂台开战失败' }))
})

/** 领赏:达标且未领才发;天榜型当日名次须在前 target 之内 */
eventRouter.post('/claim', requireAuth, (req: Request, res: Response) => {
  void (async () => {
    const now = Date.now()
    const { day, event } = todayEvent(now)
    if (!(await eventEnabled())) {
      res.status(404).json({ error: '今日无活动' })
      return
    }
    if (event.kind === 'board') {
      const rank = await leaderboardRank(req.user!.id)
      if (rank === null || rank > event.target) {
        res.status(400).json({ error: `天榜第 ${rank ?? '—'} 名,未入前 ${event.target}` })
        return
      }
      // 名次达标即视为完成:把进度补到 target,后续 check 与展示同源
      await addEventProgress(req.user!.id, day, event.id, event.target)
    }
    const reward = await claimEvent(req.user!.id, day, event.id)
    if (reward === null) {
      const mine = await eventProgress(req.user!.id, day, event.id)
      res.status(400).json({ error: mine.claimed ? '今日已领' : '尚未达成' })
      return
    }
    res.json({ reward, day, eventId: event.id })
  })().catch(() => res.status(500).json({ error: '领取失败' }))
})

/** 供其它路由记账:今日是哪一会,便于「顺手记一笔」 */
export async function todayEventFor(now = Date.now()): Promise<{ day: string; event: DailyEvent }> {
  return todayEvent(now)
}

/** 今日活动日号,供各载体路由对齐 */
export function todayKey(now = Date.now()): string {
  return dayKeyOf(now)
}
