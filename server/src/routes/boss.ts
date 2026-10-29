/** 万妖围城:全服共享血池的世界妖王;服务端权威模拟,每日出剑次数走 dungeon_daily */
import express from 'express'
import { randomInt } from 'node:crypto'
import { all, driverName, get, run, upsertByPk } from '../db.js'
import { getConfigNumber } from '../config.js'
import { requireAuth } from '../auth.js'
import { broadcastAll } from '../ws.js'

export const bossRouter = express.Router()

const IS_MYSQL = driverName() === 'mysql'

/* ---------------- GNum(m×10^e) 服务器侧算术 ---------------- */

interface GE {
  m: number
  e: number
}

function geNorm(m: number, e: number): GE {
  if (!Number.isFinite(m) || m === 0) return { m: 0, e: 0 }
  const shift = Math.floor(Math.log10(Math.abs(m)))
  const nm = m / Math.pow(10, shift)
  if (Math.abs(nm) >= 10) return geNorm(nm / 10, e + shift + 1)
  return { m: nm, e: e + shift }
}

function geAdd(a: GE, b: GE): GE {
  if (a.m === 0) return b
  if (b.m === 0) return a
  const hi = a.e >= b.e ? a : b
  const lo = a.e >= b.e ? b : a
  const diff = hi.e - lo.e
  if (diff > 15) return hi
  return geNorm(hi.m + lo.m / Math.pow(10, diff), hi.e)
}

/** a - b;b 大于 a 时结果视为 0(伤害扣除场景) */
function geSub(a: GE, b: GE): GE {
  if (b.m === 0) return a
  const diff = a.e - b.e
  if (diff > 15) return a
  if (diff < -15) return { m: 0, e: 0 }
  return geNorm(a.m - b.m / Math.pow(10, diff), a.e)
}

function geMulN(a: GE, n: number): GE {
  return geNorm(a.m * n, a.e)
}

/** 取小者;相等取 a(伤害结算按剩余血截断) */
function geMin(a: GE, b: GE): GE {
  if (a.e !== b.e) return a.e < b.e ? a : b
  return Math.abs(a.m) <= Math.abs(b.m) ? a : b
}

function geText(a: GE): string {
  if (a.m <= 0) return '0'
  if (a.e >= 6 || a.e <= -2) return `${a.m.toPrecision(4)}e${a.e}`
  return (a.m * Math.pow(10, a.e)).toPrecision(6).replace(/\.?0+$/, '')
}

function randRange(min: number, max: number): number {
  return min + (randomInt(0, 1000) / 1000) * (max - min)
}

/** 计数 upsert:双方言(仅加计数,REPLACE 语义不适用) */
async function bumpDaily(userId: number, dungeon: string, day: string): Promise<void> {
  if (IS_MYSQL) {
    await run(
      `INSERT INTO dungeon_daily (user_id, dungeon, day, count) VALUES (?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE count = count + 1`,
      [userId, dungeon, day]
    )
    return
  }
  await run(
    `INSERT INTO dungeon_daily (user_id, dungeon, day, count) VALUES (?, ?, ?, 1)
     ON CONFLICT(user_id, dungeon, day) DO UPDATE SET count = count + 1`,
    [userId, dungeon, day]
  )
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
}

interface DamageRow {
  user_id: number
  name: string
  dmg_m: number
  dmg_e: number
  strikes: number
}

/** 当日键(UTC+8);dungeon_daily 按它限次 */
function dayKey(now = Date.now()): string {
  return new Date(now + 8 * 3600_000).toISOString().slice(0, 10)
}

async function attemptsUsed(userId: number, dungeon: string, day: string): Promise<number> {
  const row = await get<{ count: number }>(
    'SELECT count FROM dungeon_daily WHERE user_id = ? AND dungeon = ? AND day = ?',
    [userId, dungeon, day]
  )
  return row?.count ?? 0
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

/** 确保有一只活妖王:无档/已死且过重生期则重生(伤害榜随之清零) */
async function ensureBoss(): Promise<BossRow> {
  const respawnSec = await getConfigNumber('boss_respawn_sec', 86_400)
  const existing = await get<BossRow>('SELECT * FROM boss_state WHERE id = 1')
  const now = Date.now()
  if (existing !== undefined) {
    const alive = existing.dead_at === 0
    const respawnDue = !alive && now - existing.dead_at >= respawnSec * 1000
    if (alive || !respawnDue) return existing
  }

  const top = await serverTop()
  const mult = await getConfigNumber('boss_hp_atk_mult', 20)
  // 血池 = 全服最强一击 × 倍率:要全服协力才推得倒
  const maxHp = geMulN(geNorm(top.atkM, top.atkE), mult)
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
    dead_at: 0
  }
  await run('DELETE FROM boss_damage')
  await run(
    `REPLACE INTO boss_state (id, name, realm_index, max_hp_m, max_hp_e, hp_m, hp_e, spawned_at, dead_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [row.id, row.name, row.realm_index, row.max_hp_m, row.max_hp_e, row.hp_m, row.hp_e, row.spawned_at]
  )
  broadcastAll({ type: 'boss_spawn', name, at: now })
  return row
}

interface StrikeSide {
  hp: GE
  atk: GE
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
    res.json({
      name: boss.name,
      realmIndex: boss.realm_index,
      alive: boss.dead_at === 0,
      hp: { m: boss.hp_m, e: boss.hp_e },
      maxHp: { m: boss.max_hp_m, e: boss.max_hp_e },
      respawnAt: boss.dead_at === 0 ? 0 : boss.dead_at + (await getConfigNumber('boss_respawn_sec', 86_400)) * 1000,
      myAttempts: used,
      maxAttempts,
      myDamage: mine === undefined ? { m: 0, e: 0 } : { m: mine.dmg_m, e: mine.dmg_e },
      top: top.map(r => ({ name: r.name, dmg: { m: r.dmg_m, e: r.dmg_e }, dmgText: geText({ m: r.dmg_m, e: r.dmg_e }) }))
    })
  })().catch(() => res.status(500).json({ error: '妖王状态读取失败' }))
})

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

    // 玩家快照:优先用档案(进过游戏就有);没档按保底值,照样能砍
    const profile = await get<{ name: string; hp_m: number; hp_e: number; atk_m: number; atk_e: number }>(
      'SELECT name, hp_m, hp_e, atk_m, atk_e FROM profiles WHERE user_id = ?',
      [req.user!.id]
    )
    const playerName = profile?.name ?? req.user!.username
    const player: StrikeSide = profile
      ? { hp: geNorm(profile.hp_m, profile.hp_e), atk: geNorm(profile.atk_m, profile.atk_e) }
      : { hp: geNorm(100, 2), atk: geNorm(10, 2) }
    // 妖王攻势 = 全服最强一击 × 0.5:高境界玩家能站满全程,低境界会被打退
    const top = await serverTop()
    const bossSide: StrikeSide = { hp: geNorm(boss.hp_m, boss.hp_e), atk: geMulN(geNorm(top.atkM, top.atkE), 0.5) }
    const rounds = await getConfigNumber('boss_strike_rounds', 10)
    const sim = simulateStrike(player, bossSide, rounds)

    // 伤害按剩余血截断;结算奖励(数量单位,客户端按 stoneByTier 折算)
    const hpLeft = { m: boss.hp_m, e: boss.hp_e }
    const applied = geMin(sim.damage, hpLeft)
    const killed = applied.e === hpLeft.e && applied.m >= hpLeft.m
    const hpAfter = geSub(hpLeft, applied)
    const stoneBase = await getConfigNumber('boss_reward_stone', 30)
    const herbBase = await getConfigNumber('boss_reward_herb', 2)
    const stone = killed ? stoneBase * 3 : stoneBase
    const herb = killed ? herbBase * 3 : herbBase

    await bumpDaily(req.user!.id, 'boss', dayKey())
    await bumpDamage(req.user!.id, playerName, applied)

    if (killed) {
      await run('UPDATE boss_state SET hp_m = 0, hp_e = 0, dead_at = ? WHERE id = 1', [Date.now()])
      const topRows = await all<DamageRow>(
        'SELECT name, dmg_m, dmg_e FROM boss_damage ORDER BY dmg_e DESC, dmg_m DESC LIMIT 10'
      )
      broadcastAll({
        type: 'boss_killed',
        by: playerName,
        name: boss.name,
        top: topRows.map(r => ({ name: r.name, dmgText: geText({ m: r.dmg_m, e: r.dmg_e }) })),
        at: Date.now()
      })
    } else {
      await run('UPDATE boss_state SET hp_m = ?, hp_e = ? WHERE id = 1', [hpAfter.m, hpAfter.e])
    }

    res.json({
      damage: { m: applied.m, e: applied.e },
      damageText: geText(applied),
      rounds,
      fell: sim.fell,
      killed,
      hp: killed ? { m: 0, e: 0 } : hpAfter,
      maxHp: { m: boss.max_hp_m, e: boss.max_hp_e },
      bossName: boss.name,
      tier: boss.realm_index,
      reward: { stone, herb }
    })
  })().catch(() => res.status(500).json({ error: '出剑失败' }))
})
