/** 万妖围城:全服共享血池的世界妖王;服务端权威模拟,每日出剑次数走 dungeon_daily */
import express from 'express'
import { randomInt } from 'node:crypto'
import { all, get, run, upsertByPk } from '../db.js'
import { getConfig, getConfigNumber } from '../config.js'
import { requireAuth } from '../auth.js'
import { broadcastAll } from '../ws.js'
import { dayKey, attemptsUsed, bumpDaily } from '../dungeonCore.js'
import { geNorm, geAdd, geSub, geMulN, geMin, geText, randRange, type GE } from '../gnum.js'

export const bossRouter = express.Router()

/* ---------------- GNum 与限次:公共实现见 gnum.ts / dungeonCore.ts ---------------- */

interface DamageRow {
  user_id: number
  name: string
  dmg_m: number
  dmg_e: number
  strikes: number
}

async function bumpDamage(userId: number, name: string, dmg: GE): Promise<void> {
  // GNum 跨指数累加在应用层做,落库走双方言同语义的 REPLACE INTO
  const existing = await get<DamageRow>('SELECT user_id, name, dmg_m, dmg_e, strikes FROM boss_damage WHERE user_id = ?', [
    userId
  ])
  const next = existing === undefined ? dmg : geAdd({ m: existing.dmg_m, e: existing.dmg_e }, dmg)
  await upsertByPk('boss_damage', {
    user_id: userId,
    name,
    dmg_m: next.m,
    dmg_e: next.e,
    strikes: (existing?.strikes ?? 0) + 1,
    updated_at: Date.now()
  })
}

/* ---------------- 妖王数据 ---------------- */

const BOSS_NAMES = ['赤炎妖王', '玄冰妖王', '九婴', '穷奇', '饕餮', '梼杌', '浑敦', '刑天残魄', '烛阴', '相柳']

interface BossRow {
  id: number
  name: string
  realm_index: number
  max_hp_m: number
  max_hp_e: number
  hp_m: number
  hp_e: number
  spawned_at: number
  dead_at: number
  kill_count: number
  period_start: number
}

interface DamageRow {
  user_id: number
  name: string
  dmg_m: number
  dmg_e: number
  strikes: number
}

interface TopProfile {
  atkM: number
  atkE: number
  maxRealm: number
}

/** 服务器最强攻击与最高境界:决定妖王强度;没有档时用新手保底值 */
async function serverTop(): Promise<TopProfile> {
  const row = await get<{ m: number; e: number; realm: number }>(
    'SELECT MAX(atk_m) AS m, MAX(atk_e) AS e, MAX(realm_index) AS realm FROM profiles'
  )
  if (row === undefined || (row.m ?? 0) <= 0) {
    return { atkM: 100, atkE: 3, maxRealm: 0 }
  }
  return { atkM: row.m, atkE: row.e, maxRealm: row.realm ?? 0 }
}

/** 妖王成长:本周期击杀 N 次则强度 ×(1 + N×每杀增幅);过周期击杀数清零 */
async function growthMult(killCount: number): Promise<number> {
  const perKill = await getConfigNumber('boss_growth_per_kill', 5)
  const mult = 1 + (killCount * perKill) / 100
  return Math.min(mult, 10)
}

/** 周期到期(或无周期)则重置击杀数并开新周期;返回最新行 */
async function rolloverGrowthPeriod(boss: BossRow): Promise<BossRow> {
  const resetDays = await getConfigNumber('boss_growth_reset_days', 30)
  const now = Date.now()
  if (boss.period_start > 0 && now - boss.period_start < resetDays * 86_400_000) return boss
  boss.kill_count = 0
  boss.period_start = now
  await run('UPDATE boss_state SET kill_count = 0, period_start = ? WHERE id = 1', [now])
  return boss
}

/** 确保有一只活妖王:无档/已死且过重生期则重生(伤害榜随之清零);离线托管任务也走这里补重生 */
export async function ensureBoss(): Promise<BossRow> {
  const respawnSec = await getConfigNumber('boss_respawn_sec', 86_400)
  const existing = await get<BossRow>('SELECT * FROM boss_state WHERE id = 1')
  const now = Date.now()
  if (existing !== undefined) {
    const alive = existing.dead_at === 0
    const respawnDue = !alive && now - existing.dead_at >= respawnSec * 1000
    if (alive || !respawnDue) {
      if (alive) await rolloverGrowthPeriod(existing)
      return existing
    }
  }

  const top = await serverTop()
  const mult = await getConfigNumber('boss_hp_atk_mult', 20)
  // 成长周期:新妖王出生时若旧周期已过窗口则击杀数清零,否则沿用(越杀越强)
  const killCount = existing !== undefined ? existing.kill_count : 0
  let periodStart = existing !== undefined ? existing.period_start : 0
  const resetDays = await getConfigNumber('boss_growth_reset_days', 30)
  if (periodStart <= 0 || now - periodStart >= resetDays * 86_400_000) periodStart = now
  const grown = await growthMult(killCount)
  // 血池 = 全服最强一击 × 倍率 × 成长:要全服协力才推得倒
  const maxHp = geMulN(geMulN(geNorm(top.atkM, top.atkE), mult), grown)
  const name = BOSS_NAMES[randomInt(0, BOSS_NAMES.length)]!
  const row: BossRow = {
    id: 1,
    name,
    realm_index: top.maxRealm,
    max_hp_m: maxHp.m,
    max_hp_e: maxHp.e,
    hp_m: maxHp.m,
    hp_e: maxHp.e,
    spawned_at: now,
    dead_at: 0,
    kill_count: killCount,
    period_start: periodStart
  }
  await run('DELETE FROM boss_damage')
  await run(
    `REPLACE INTO boss_state (id, name, realm_index, max_hp_m, max_hp_e, hp_m, hp_e, spawned_at, dead_at, kill_count, period_start)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    [row.id, row.name, row.realm_index, row.max_hp_m, row.max_hp_e, row.hp_m, row.hp_e, row.spawned_at, killCount, periodStart]
  )
  broadcastAll({ type: 'boss_spawn', name, at: now })
  return row
}

interface StrikeSide {
  hp: GE
  atk: GE
}

/** a/b 的近似比:按指数差算,避免 10^e 溢出成 Infinity/0 */
function geDiv(a: GE, b: GE): number {
  if (b.m === 0) return a.m === 0 ? 0 : Number.POSITIVE_INFINITY
  const de = a.e - b.e
  if (de > 12) return Number.POSITIVE_INFINITY
  if (de < -12) return 0
  return (a.m / b.m) * Math.pow(10, de)
}

/** 距当日次数重置(UTC+8 零点)还有多少分钟 */
function minutesToDailyReset(now = Date.now()): number {
  const utc8 = now + 8 * 3600_000
  return (86_400_000 - (utc8 % 86_400_000)) / 60_000
}

/** 托管「量力而行」:最后一刻(次数即将作废)兜底出手的窗口 */
const LAST_CALL_MIN = 30

/** 托管是否按战力评估决定出剑(GM 可关,关掉即回到「有次数就打」) */
async function smartAutoOps(): Promise<boolean> {
  const v = await getConfig('boss_autoops_smart', '1')
  return !(v === '0' || v === 'false')
}

/** 一剑双方的对位快照:评估与成交共用同一套参数,避免两处口径漂移 */
interface Sides {
  hasProfile: boolean
  playerName: string
  player: StrikeSide
  boss: BossRow
  bossSide: StrikeSide
  rounds: number
  grown: number
}

/**
 * 取一剑的对位:玩家(档案快照;无档按新手保底)对妖王。
 * 妖王攻势 = 全服最强一击 × 0.5 × 成长:高境界玩家站得满全程,低境界会被打退半程。
 */
async function combatSides(userId: number, bossRow?: BossRow): Promise<Sides> {
  const boss = bossRow ?? (await ensureBoss())
  const profile = await get<{ name: string; hp_m: number; hp_e: number; atk_m: number; atk_e: number }>(
    'SELECT name, hp_m, hp_e, atk_m, atk_e FROM profiles WHERE user_id = ?',
    [userId]
  )
  const top = await serverTop()
  const grown = await growthMult(boss.kill_count)
  return {
    hasProfile: profile !== undefined,
    playerName: profile?.name ?? '',
    player: profile
      ? { hp: geNorm(profile.hp_m, profile.hp_e), atk: geNorm(profile.atk_m, profile.atk_e) }
      : { hp: geNorm(100, 2), atk: geNorm(10, 2) },
    boss,
    bossSide: {
      hp: geNorm(boss.hp_m, boss.hp_e),
      atk: geMulN(geMulN(geNorm(top.atkM, top.atkE), 0.5), grown)
    },
    rounds: await getConfigNumber('boss_strike_rounds', 10),
    grown
  }
}

/** 托管预判:这一剑打出去能伤多少、会不会被打退、够不够补刀 */
export interface StrikeAssessment {
  hasProfile: boolean
  /** 预计一剑伤害(期望值,不含 ±15% 随机) */
  projected: GE
  /** 预计伤害 / 妖王剩余气血;≥1 即有望补掉 */
  hpShare: number
  /** 能撑满全部回合不被打退 */
  steady: boolean
  /** 留出随机余量后仍有把握一剑补掉 */
  canFinish: boolean
  /** 此刻托管该不该出剑 */
  worthIt: boolean
  reason: 'finish' | 'steady' | 'hold' | 'last-call' | 'no-profile' | 'no-boss'
}

/**
 * 评估托管的一剑:优先补刀(三倍),其次站得住就砍;
 * 明显打不过则蓄势留剑(次数不过期),只在临近重置时兜底出手。
 */
export async function assessStrike(userId: number, bossRow?: BossRow): Promise<StrikeAssessment> {
  const s = await combatSides(userId, bossRow)
  const hpLeft = geNorm(s.boss.hp_m, s.boss.hp_e)
  const blank: StrikeAssessment = {
    hasProfile: s.hasProfile,
    projected: { m: 0, e: 0 },
    hpShare: 0,
    steady: false,
    canFinish: false,
    worthIt: false,
    reason: 'no-boss'
  }
  if (s.boss.dead_at !== 0 || hpLeft.m <= 0) return blank

  // 站得住几回合:自身气血 ÷ 每回合所受攻势(倒下后残余回合伤害减半)
  const bossAtk = s.bossSide.atk
  const survived =
    bossAtk.m <= 0 ? s.rounds : Math.min(s.rounds, Math.max(0, Math.ceil(geDiv(s.player.hp, bossAtk))))
  const steady = survived >= s.rounds
  const projected = geAdd(
    geMulN(s.player.atk, survived),
    geMulN(s.player.atk, (s.rounds - survived) * 0.5)
  )
  const hpShare = geDiv(projected, hpLeft)
  const canFinish = hpShare >= 1.15 // 随机 ±15% 之外还要有富余,才叫「有把握补刀」

  let worthIt = true
  let reason: StrikeAssessment['reason'] = 'steady'
  if (!s.hasProfile) {
    worthIt = false
    reason = 'no-profile'
  } else if (canFinish) {
    reason = 'finish'
  } else if (steady) {
    reason = 'steady'
  } else if (minutesToDailyReset() <= LAST_CALL_MIN) {
    reason = 'last-call'
  } else {
    worthIt = false
    reason = 'hold'
  }
  if (!(await smartAutoOps())) worthIt = s.hasProfile
  return { hasProfile: s.hasProfile, projected, hpShare, steady, canFinish, worthIt, reason }
}

/** 一剑 = N 回合轮流对轰;玩家倒下后残余回合伤害减半(困兽犹斗) */
function simulateStrike(player: StrikeSide, boss: StrikeSide, rounds: number): { damage: GE; fell: boolean } {
  let hp = player.hp
  const bossAtk = boss.atk
  let total: GE = { m: 0, e: 0 }
  let fell = false
  for (let i = 1; i <= rounds; i++) {
    const dmg = geMulN(player.atk, randRange(0.85, 1.15))
    total = geAdd(total, fell ? geMulN(dmg, 0.5) : dmg)
    hp = geSub(hp, geMulN(bossAtk, randRange(0.85, 1.15)))
    if (hp.m <= 0 && !fell) fell = true
  }
  return { damage: total, fell }
}

/* ---------------- 接口 ---------------- */

/** 妖王状态 + 我的次数与伤害 + 贡献榜 */
bossRouter.get('/', requireAuth, (req, res) => {
  void (async () => {
    const boss = await ensureBoss()
    const maxAttempts = await getConfigNumber('boss_daily_attempts', 1)
    const used = await attemptsUsed(req.user!.id, 'boss', dayKey())
    const mine = await get<DamageRow>(
      'SELECT user_id, name, dmg_m, dmg_e, strikes FROM boss_damage WHERE user_id = ?',
      [req.user!.id]
    )
    const top = await all<DamageRow>(
      'SELECT user_id, name, dmg_m, dmg_e, strikes FROM boss_damage ORDER BY dmg_e DESC, dmg_m DESC LIMIT 20'
    )
    const grown = await growthMult(boss.kill_count)
    const resetDays = await getConfigNumber('boss_growth_reset_days', 30)
    const assess = await assessStrike(req.user!.id, boss)
    res.json({
      name: boss.name,
      realmIndex: boss.realm_index,
      alive: boss.dead_at === 0,
      hp: { m: boss.hp_m, e: boss.hp_e },
      maxHp: { m: boss.max_hp_m, e: boss.max_hp_e },
      respawnAt: boss.dead_at === 0 ? 0 : boss.dead_at + (await getConfigNumber('boss_respawn_sec', 86_400)) * 1000,
      growth: {
        killCount: boss.kill_count,
        mult: Math.round(grown * 100) / 100,
        resetAt: boss.period_start + resetDays * 86_400_000
      },
      myAttempts: used,
      maxAttempts,
      // 托管预判:这一剑的期望伤害与「值不值得出」的结论(在线托管与页面提示共用)
      assess: {
        worthIt: assess.worthIt,
        steady: assess.steady,
        canFinish: assess.canFinish,
        hpShare: Math.round(assess.hpShare * 1000) / 1000,
        projected: { m: assess.projected.m, e: assess.projected.e },
        reason: assess.reason
      },
      myDamage: mine === undefined ? { m: 0, e: 0 } : { m: mine.dmg_m, e: mine.dmg_e },
      top: top.map(r => ({ name: r.name, dmg: { m: r.dmg_m, e: r.dmg_e }, dmgText: geText({ m: r.dmg_m, e: r.dmg_e }) }))
    })
  })().catch(() => res.status(500).json({ error: '妖王状态读取失败' }))
})

/** 出剑结算结果(在线路由与离线托管任务共用) */
export interface StrikeOutcome {
  applied: GE
  rounds: number
  fell: boolean
  killed: boolean
  hp: GE
  maxHp: GE
  bossName: string
  tier: number
  reward: { stone: number; herb: number }
  growthMult: number
  killCount: number
}

/**
 * 出剑一次:服务端模拟、按剩余血截断、即时结算奖励与榜单;击杀则记入成长周期。
 * 调用方须自行完成「妖王存活」「当日次数未用尽」的前置校验。
 */
export async function performStrike(userId: number): Promise<StrikeOutcome> {
  const s = await combatSides(userId)
  const boss = s.boss
  const playerName = s.playerName
  const grown = s.grown
  const sim = simulateStrike(s.player, s.bossSide, s.rounds)

  // 伤害按剩余血截断;结算奖励(数量单位,客户端按 stoneByTier 折算)
  const hpLeft = s.bossSide.hp
  const applied = geMin(sim.damage, hpLeft)
  const killed = applied.e === hpLeft.e && applied.m >= hpLeft.m
  const hpAfter = geSub(hpLeft, applied)
  const stoneBase = await getConfigNumber('boss_reward_stone', 30)
  const herbBase = await getConfigNumber('boss_reward_herb', 2)
  const stone = killed ? stoneBase * 3 : stoneBase
  const herb = killed ? herbBase * 3 : herbBase

  await bumpDaily(userId, 'boss', dayKey())
  await bumpDamage(userId, playerName || `道友${userId}`, applied)

  if (killed) {
    // 击杀入成长账:周期内的第 N 次击杀,下只妖王按 N 增强
    const killCount = boss.kill_count + 1
    await run('UPDATE boss_state SET hp_m = 0, hp_e = 0, dead_at = ?, kill_count = ? WHERE id = 1', [Date.now(), killCount])
    const topRows = await all<DamageRow>(
      'SELECT name, dmg_m, dmg_e FROM boss_damage ORDER BY dmg_e DESC, dmg_m DESC LIMIT 10'
    )
    broadcastAll({
      type: 'boss_killed',
      by: playerName || `道友${userId}`,
      name: boss.name,
      top: topRows.map(r => ({ name: r.name, dmgText: geText({ m: r.dmg_m, e: r.dmg_e }) })),
      at: Date.now()
    })
    boss.kill_count = killCount
  } else {
    await run('UPDATE boss_state SET hp_m = ?, hp_e = ? WHERE id = 1', [hpAfter.m, hpAfter.e])
  }

  return {
    applied,
    rounds: s.rounds,
    fell: sim.fell,
    killed,
    hp: killed ? { m: 0, e: 0 } : hpAfter,
    maxHp: { m: boss.max_hp_m, e: boss.max_hp_e },
    bossName: boss.name,
    tier: boss.realm_index,
    reward: { stone, herb },
    growthMult: grown,
    killCount: boss.kill_count
  }
}

/** 出剑:每日限次(默认 1),服务端模拟并即时结算奖励 */
bossRouter.post('/strike', requireAuth, (req, res) => {
  void (async () => {
    const boss = await ensureBoss()
    if (boss.dead_at !== 0) {
      res.status(409).json({ error: '妖王已陨落,静候重生' })
      return
    }
    const limit = await getConfigNumber('boss_daily_attempts', 1)
    const used = await attemptsUsed(req.user!.id, 'boss', dayKey())
    if (used >= limit) {
      res.status(429).json({ error: `今日已出手,明日再战` })
      return
    }

    const r = await performStrike(req.user!.id)
    res.json({
      damage: { m: r.applied.m, e: r.applied.e },
      damageText: geText(r.applied),
      rounds: r.rounds,
      fell: r.fell,
      killed: r.killed,
      hp: r.hp,
      maxHp: r.maxHp,
      bossName: r.bossName,
      tier: r.tier,
      reward: r.reward
    })
  })().catch(() => res.status(500).json({ error: '出剑失败' }))
})
