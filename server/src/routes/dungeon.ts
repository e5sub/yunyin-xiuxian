/**
 * 多人副本路由:房间码 + 心魔镜像 / 秘境共探 / 洞天守卫 / 共修大阵
 * 服务端权威模拟;每日次数各自独立(<key>_daily_attempts,默认 1)走 dungeon_daily
 * 房间:6 位房间码,输入相同码自动进房(已在别的房间会自动退出);开拔校验全员次数,结算即解散房间
 */
import express, { type Request, type Response } from 'express'
import { get } from '../db.js'
import { requireAuth } from '../auth.js'
import { getConfigNumber } from '../config.js'
import { notifyUser } from '../ws.js'
import {
  DUNGEONS,
  DUNGEON_NAMES,
  ROOM_MAX_SIZE,
  attemptsLimit,
  attemptsUsed,
  bumpDaily,
  createRoom,
  currentRoomOf,
  dayKey,
  disbandRoom,
  isDungeonKey,
  joinRoom,
  leaveRoom,
  resolveRunRoster,
  roomSnapshot,
  type DungeonKey
} from '../dungeonCore.js'
import { geAdd, geMulN, geNorm, geSub, geText, randRange, randomIntRange, type GE } from '../gnum.js'

export const dungeonRouter = express.Router()

/* ---------------- 玩家快照 ---------------- */

interface MemberFighter {
  userId: number
  name: string
  hp: GE
  atk: GE
  realm: number
}

const NEWBIE_HP = geNorm(100, 2)
const NEWBIE_ATK = geNorm(10, 2)

async function loadFighters(roster: Array<{ userId: number; name: string }>): Promise<MemberFighter[]> {
  const out: MemberFighter[] = []
  for (const r of roster) {
    const p = await get<{ name: string; hp_m: number; hp_e: number; atk_m: number; atk_e: number; realm_index: number }>(
      'SELECT name, hp_m, hp_e, atk_m, atk_e, realm_index FROM profiles WHERE user_id = ?',
      [r.userId]
    )
    out.push({
      userId: r.userId,
      name: p?.name ?? r.name,
      hp: p ? geNorm(p.hp_m, p.hp_e) : NEWBIE_HP,
      atk: p ? geNorm(p.atk_m, p.atk_e) : NEWBIE_ATK,
      realm: p?.realm_index ?? 0
    })
  }
  return out
}

function totalOf(list: GE[]): GE {
  return list.reduce((acc, v) => geAdd(acc, v), { m: 0, e: 0 })
}

function maxOf(list: GE[]): GE {
  return list.reduce((acc, v) => (v.e > acc.e || (v.e === acc.e && v.m > acc.m) ? v : acc), { m: 0, e: 0 })
}

interface SimResult {
  win: boolean
  log: string[]
  stone: number
  herb: number
}

/* ---------------- 心魔镜像 ---------------- */

const DEMON_LINES = [
  '心魔冷笑:「你我本是一体,何苦向外求道。」',
  '心魔低语:「当年观里那盏灯,你还记得吗?」',
  '心魔化作你的模样,招式分毫不差。',
  '心魔忽而泣下:「你若飞升,谁还记得旧日山河。」',
  '心魔散作青烟,只留一句:「下一次,我还会来。」'
]

interface DemonCfg {
  demon_hp_base: number
  demon_atk_mult: number
  demon_reward_stone: number
  demon_reward_herb: number
}

/**
 * 心魔镜像:全员的心念凝成一只合体心魔。
 * 血 = 房内最高攻 × demon_hp_base × 人数^0.8(人多心魔更壮,但合击涨得更快,人多才有胜算);
 * 攻 = 最高攻 × demon_atk_mult%。
 * 12 轮内合击轰破则胜;血池血空(全员倒下)后合击减半。
 * 独行:心魔血 ≈ 13×自身攻,12 轮合击 ≈ 12×攻 → 大概率不胜;2 人同境界起才有稳定胜算。
 */
function runDemon(room: MemberFighter[], cfg: DemonCfg): SimResult {
  const n = room.length
  const sumAtk = totalOf(room.map(m => m.atk))
  const maxAtk = maxOf(room.map(m => m.atk))
  const poolHp = totalOf(room.map(m => m.hp))
  const demonHp = geMulN(maxAtk, Math.max(1, cfg.demon_hp_base) * Math.pow(n, 0.8))
  const demonAtk = geMulN(maxAtk, Math.max(5, cfg.demon_atk_mult) / 100)
  const rounds = 12
  const log: string[] = [
    `众人心念一颤——合体心魔现形!气血 ${geText(demonHp)},攻势 ${geText(demonAtk)}。`
  ]
  let demonLeft = demonHp
  let poolLeft = poolHp
  let win = false
  let quipDone = false
  for (let i = 1; i <= rounds; i++) {
    const fallen = poolLeft.m <= 0
    const strike = geMulN(sumAtk, randRange(0.85, 1.15) * (fallen ? 0.5 : 1))
    demonLeft = geSub(demonLeft, strike)
    poolLeft = geSub(poolLeft, geMulN(demonAtk, randRange(0.85, 1.15)))
    if (i <= 6 || demonLeft.m <= 0) {
      log.push(`第${i}轮 · 合击 ${geText(strike)},心魔余血 ${geText(geMax0(demonLeft))}`)
    } else if (i === 7) {
      log.push('……')
    }
    if (!quipDone && i === randomIntRange(2, 6)) {
      log.push(DEMON_LINES[randomIntRange(0, DEMON_LINES.length)]!)
      quipDone = true
    }
    if (demonLeft.m <= 0) {
      win = true
      log.push(`心魔溃散!${fallen ? '众人身受重伤,仍斩落心魔。' : '心神澄澈,道基更稳。'}`)
      break
    }
  }
  if (!win) log.push(DEMON_LINES[randomIntRange(0, DEMON_LINES.length)]!)
  const stone = Math.max(1, Math.round(cfg.demon_reward_stone * (1 + 0.25 * (n - 1)) * (win ? 1 : 1 / 3)))
  const herb = Math.max(1, Math.round(cfg.demon_reward_herb * (1 + 0.25 * (n - 1)) * (win ? 1 : 1 / 3)))
  log.push(win ? `道心通明!每人得灵石 ${stone} · 灵草 ${herb}。` : `不敌而退,仅拾得残念:灵石 ${stone} · 灵草 ${herb}。`)
  return { win, log, stone, herb }
}

function geMax0(a: GE): GE {
  return a.m <= 0 ? { m: 0, e: 0 } : a
}

/* ---------------- 秘境共探 ---------------- */

const EXPLORE_SPOTS = ['断崖石林', '沉沙古渡', '枯藤涧', '幽篁谷', '荒祠', '白骨滩', '云梦泽', '落星原', '古剑冢', '雾隐泽']

interface ExploreCfg {
  explore_nodes: number
  explore_reward_stone: number
  explore_reward_herb: number
}

/**
 * 秘境共探:随机走出一条秘境小径,每个节点掷一种机缘;
 * 妖兽伏击有小战斗(3 回合,房间总攻 vs 妖兽),击破多拾一份,血池血空则提前退出。
 */
function runExplore(room: MemberFighter[], cfg: ExploreCfg): SimResult {
  const n = room.length
  const nodes = Math.max(3, Math.min(12, Math.round(cfg.explore_nodes)))
  const sumAtk = totalOf(room.map(m => m.atk))
  const maxAtk = maxOf(room.map(m => m.atk))
  const poolHp = totalOf(room.map(m => m.hp))
  let stone = 0
  let herb = 0
  let poolLeft = poolHp
  const log: string[] = [`一行${n}人踏入秘境,雾气扑面。`]
  for (let i = 1; i <= nodes; i++) {
    const spot = EXPLORE_SPOTS[randomIntRange(0, EXPLORE_SPOTS.length)]!
    const roll = randomIntRange(0, 100)
    if (roll < 25) {
      const got = Math.max(1, Math.round(cfg.explore_reward_stone * randRange(0.5, 1.2)))
      stone += got
      log.push(`「${spot}」拾得灵石矿脉,采得灵石 ${got}。`)
    } else if (roll < 45) {
      const got = Math.max(1, Math.round(cfg.explore_reward_herb * randRange(0.5, 1.5)))
      herb += got
      log.push(`「${spot}」灵草圃丰茂,摘得灵草 ${got}。`)
    } else if (roll < 57) {
      const got = Math.max(2, Math.round(cfg.explore_reward_stone * randRange(1.5, 3)))
      stone += got
      log.push(`「${spot}」掘开遗迹宝箱,灵石 ${got}!`)
    } else if (roll < 75) {
      // 妖兽强度按人数缩放(最高攻 × 2.8~4.2 × 人数^0.8):独行 3 回合合击(≈3×攻)大多不胜,人多才稳破
      const beastHp = geMulN(maxAtk, randRange(2.8, 4.2) * Math.pow(n, 0.8))
      const beastAtk = geMulN(maxAtk, randRange(0.25, 0.45))
      let left = beastHp
      let broke = false
      for (let r = 1; r <= 3; r++) {
        left = geSub(left, geMulN(sumAtk, randRange(0.85, 1.15)))
        poolLeft = geSub(poolLeft, geMulN(beastAtk, randRange(0.85, 1.15)))
        if (left.m <= 0) {
          broke = true
          break
        }
      }
      if (broke) {
        const got = Math.max(1, Math.round(cfg.explore_reward_stone * randRange(1.2, 1.8)))
        stone += got
        log.push(`「${spot}」妖兽伏击!众剑齐出斩之,夺回灵石 ${got}。`)
      } else {
        log.push(`「${spot}」妖兽伏击!缠斗不克,妖兽遁走。`)
      }
      if (poolLeft.m <= 0) {
        log.push('众人伤重,提前退出秘境。')
        break
      }
    } else if (roll < 85) {
      herb += 1
      log.push(`「${spot}」觅得地心灵泉,饮之精神一振,灵草 +1。`)
    } else {
      log.push(`「${spot}」迷雾歧路,踌躇半晌,无功而返。`)
    }
  }
  stone = Math.max(1, Math.round(stone * (1 + 0.1 * (n - 1))))
  log.push(`走出秘境:每人分得灵石 ${stone} · 灵草 ${herb}。`)
  return { win: true, log, stone, herb }
}

/* ---------------- 洞天守卫 ---------------- */

const GUARD_NAMES = ['妖潮·先锋狼骑', '妖潮·骨鸦群', '妖潮·双头蟒', '妖潮·石甲傀儡', '妖潮·妖将', '妖潮·妖帅亲卫', '妖潮·妖帅', '妖潮·万妖之王影']

interface GuardCfg {
  guard_max_waves: number
  guard_reward_stone: number
  guard_reward_herb: number
}

/**
 * 洞天守卫:守自家洞天,妖潮一波比一波凶。
 * 总波数 = 3 + 房内最高境界÷2(上限 guard_max_waves);每波击破计功,打不动即破防而止。
 * 守满全部波次功劳 ×1.5。
 */
function runGuard(room: MemberFighter[], cfg: GuardCfg): SimResult {
  const n = room.length
  const sumAtk = totalOf(room.map(m => m.atk))
  const maxAtk = maxOf(room.map(m => m.atk))
  const poolHp = totalOf(room.map(m => m.hp))
  const maxRealm = Math.max(...room.map(m => m.realm))
  const cap = Math.max(3, Math.round(cfg.guard_max_waves))
  const totalWaves = Math.min(cap, 3 + Math.floor(maxRealm / 2))
  let poolLeft = poolHp
  let cleared = 0
  const log: string[] = [`${room.length}人登陴守御,妖潮共 ${totalWaves} 波,大阵全开。`]
  for (let w = 1; w <= totalWaves; w++) {
    const label = GUARD_NAMES[Math.min(w - 1, GUARD_NAMES.length - 1)]!
    // 妖潮随人数变多变壮(血 ×人数^0.75,攻 ×人数^0.6):人多守得更深,但不是白送
    const waveHp = geMulN(maxAtk, (0.4 + 0.35 * w) * Math.pow(n, 0.75) * randRange(0.9, 1.1))
    const waveAtk = geMulN(maxAtk, (0.2 + 0.12 * w) * Math.pow(n, 0.6) * randRange(0.9, 1.1))
    const fallen = poolLeft.m <= 0
    const blow = geMulN(sumAtk, randRange(0.85, 1.15) * (fallen ? 0.5 : 1))
    log.push(`第${w}波「${label}」(气血 ${geText(waveHp)},攻势 ${geText(waveAtk)}) · 合击 ${geText(blow)}`)
    if (blow.e > waveHp.e || (blow.e === waveHp.e && blow.m >= waveHp.m)) {
      cleared = w
      poolLeft = geSub(poolLeft, waveAtk)
      log.push(`守住!大阵余量 ${geText(geMax0(poolLeft))}。`)
    } else {
      log.push('妖势太盛,这一波破防而入!')
      break
    }
    if (poolLeft.m <= 0 && w < totalWaves) log.push('大阵摇摇欲坠,守军凭意志死撑(战力减半)。')
  }
  const fullClear = cleared >= totalWaves
  const stone = Math.max(0, Math.round(cfg.guard_reward_stone * cleared * (fullClear ? 1.5 : 1)))
  const herb = Math.max(0, Math.round(cfg.guard_reward_herb * cleared * (fullClear ? 1.5 : 1)))
  log.push(
    fullClear
      ? `妖潮尽退!守满 ${cleared} 波,功劳倍计:每人灵石 ${stone} · 灵草 ${herb}。`
      : `守至第 ${cleared} 波,拾得战获:每人灵石 ${stone} · 灵草 ${herb}。`
  )
  return { win: fullClear, log, stone, herb }
}

/* ---------------- 共修大阵 ---------------- */

const ARRAY_LINES = [
  '阵纹次第亮起,灵气如溪汇海。',
  '众人吐纳相合,隐有道音环绕。',
  '阵眼微颤,似有一瞬窥见天道背影。',
  '灵机过处,草木皆春。'
]

interface ArrayCfg {
  array_reward_stone: number
  array_reward_herb: number
}

/**
 * 共修大阵:不斗法,只论心意相通。
 * 共鸣率 = 20% + 9%×(人数-1) + 5%×境界层次数(上限 95%):独行仅 ~25%,结伴才容易共鸣;
 * 共鸣则灵石翻倍;人越多、境界越杂,分润越厚。
 */
function runArray(room: MemberFighter[], cfg: ArrayCfg): SimResult {
  const n = room.length
  const distinctRealms = new Set(room.map(m => m.realm)).size
  const resonanceChance = Math.min(0.2 + 0.09 * (n - 1) + 0.05 * distinctRealms, 0.95)
  const resonant = Math.random() < resonanceChance
  const log: string[] = [
    `${n}人按方位入阵,道号相闻,灵机相应。`,
    ARRAY_LINES[randomIntRange(0, ARRAY_LINES.length)]!,
    `境界层次 ${distinctRealms} 重 · 共鸣率 ${Math.round(resonanceChance * 100)}%`
  ]
  const stone = Math.max(1, Math.round(cfg.array_reward_stone * (1 + 0.6 * (n - 1)) * (resonant ? 2 : 1)))
  const herb = Math.max(1, Math.round(cfg.array_reward_herb * (1 + 0.4 * (n - 1)) * (resonant ? 1.5 : 1)))
  if (resonant) {
    log.push('轰——大阵共鸣!灵潮倒卷,众人大有所获。')
  } else {
    log.push('阵光明灭,终究差了一分默契,稳收分润。')
  }
  log.push(`散阵分润:每人灵石 ${stone} · 灵草 ${herb}。`)
  return { win: resonant, log, stone, herb }
}

/* ---------------- 路由 ---------------- */

const DUNGEON_DESCS: Record<DungeonKey, string> = {
  demon: '全员心念凝成合体心魔,人多心魔越壮;12 轮内轰破则胜',
  explore: '随机秘境小径,妖兽凶悍,结伴方有胜算',
  guard: '妖潮一波比一波凶,人多阵固,守住越多功劳越大',
  array: '不斗法只论默契,人多境界越杂分润越厚'
}

async function dungeonConfig(dungeon: DungeonKey): Promise<DemonCfg | ExploreCfg | GuardCfg | ArrayCfg> {
  if (dungeon === 'demon') {
    return {
      demon_hp_base: await getConfigNumber('demon_hp_base', 13),
      demon_atk_mult: await getConfigNumber('demon_atk_mult', 60),
      demon_reward_stone: await getConfigNumber('demon_reward_stone', 60),
      demon_reward_herb: await getConfigNumber('demon_reward_herb', 4)
    }
  }
  if (dungeon === 'explore') {
    return {
      explore_nodes: await getConfigNumber('explore_nodes', 6),
      explore_reward_stone: await getConfigNumber('explore_reward_stone', 40),
      explore_reward_herb: await getConfigNumber('explore_reward_herb', 3)
    }
  }
  if (dungeon === 'guard') {
    return {
      guard_max_waves: await getConfigNumber('guard_max_waves', 9),
      guard_reward_stone: await getConfigNumber('guard_reward_stone', 10),
      guard_reward_herb: await getConfigNumber('guard_reward_herb', 1)
    }
  }
  return {
    array_reward_stone: await getConfigNumber('array_reward_stone', 25),
    array_reward_herb: await getConfigNumber('array_reward_herb', 2)
  }
}

/** 副本总览:各副本次数 + 我的房间 */
dungeonRouter.get('/', requireAuth, (req: Request, res: Response) => {
  void (async () => {
    const day = dayKey()
    const room = await currentRoomOf(req.user!.id)
    const dungeons = []
    for (const key of DUNGEONS) {
      dungeons.push({
        key,
        name: DUNGEON_NAMES[key],
        desc: DUNGEON_DESCS[key],
        used: await attemptsUsed(req.user!.id, key, day),
        max: await attemptsLimit(key)
      })
    }
    res.json({
      dungeons,
      maxSize: ROOM_MAX_SIZE,
      room: room === null ? null : await roomSnapshot(room)
    })
  })().catch(() => res.status(500).json({ error: '副本状态读取失败' }))
})

/** 我的房间(轮询用) */
dungeonRouter.get('/room', requireAuth, (req: Request, res: Response) => {
  void (async () => {
    const room = await currentRoomOf(req.user!.id)
    res.json({ room: room === null ? null : await roomSnapshot(room) })
  })().catch(() => res.status(500).json({ error: '服务器异常' }))
})

/** 建房(会自动退出旧房间) */
dungeonRouter.post('/room', requireAuth, (req: Request, res: Response) => {
  void (async () => {
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>
    if (!isDungeonKey(body.dungeon)) {
      res.status(400).json({ error: '未知副本' })
      return
    }
    const name = await myName(req.user!.id, req.user!.username)
    const r = await createRoom(req.user!.id, name, body.dungeon)
    res.json({ room: r.room })
  })().catch(e => res.status(400).json({ error: e instanceof Error ? e.message : '建房失败' }))
})

/** 凭房间码进房:同码即入 */
dungeonRouter.post('/room/join', requireAuth, (req: Request, res: Response) => {
  void (async () => {
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>
    const code = typeof body.code === 'string' ? body.code : ''
    if (!/^[A-Za-z0-9]{4,8}$/.test(code.trim())) {
      res.status(400).json({ error: '房间码格式不对' })
      return
    }
    const name = await myName(req.user!.id, req.user!.username)
    const r = await joinRoom(req.user!.id, name, code)
    res.json({ room: r.room, leftCode: r.leftCode, full: r.full })
  })().catch(e => res.status(400).json({ error: e instanceof Error ? e.message : '进房失败' }))
})

dungeonRouter.post('/room/leave', requireAuth, (req: Request, res: Response) => {
  void (async () => {
    await leaveRoom(req.user!.id, true)
    res.json({ ok: true })
  })().catch(() => res.status(500).json({ error: '服务器异常' }))
})

/** 开拔:code 空 = 独行;全员扣次数;结算即解散房间;在线道友收 ws 战报 */
dungeonRouter.post('/run', requireAuth, (req: Request, res: Response) => {
  void (async () => {
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>
    if (!isDungeonKey(body.dungeon)) {
      res.status(400).json({ error: '未知副本' })
      return
    }
    const dungeon = body.dungeon
    const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : ''
    const roster = await resolveRunRoster(req.user!.id, code)
    const fighters = await loadFighters(roster)

    // 全员次数校验:任何一个不足都不开拔(名单点名)
    const day = dayKey()
    const limit = await attemptsLimit(dungeon)
    const lacking: string[] = []
    for (const f of fighters) {
      const used = await attemptsUsed(f.userId, dungeon, day)
      if (used >= limit) lacking.push(f.name)
    }
    if (lacking.length > 0) {
      res.status(429).json({ error: `今日次数已用尽:${lacking.join('、')}` })
      return
    }

    for (const m of roster) await bumpDaily(m.userId, dungeon, day)
    const cfg = await dungeonConfig(dungeon)
    const sim =
      dungeon === 'demon'
        ? runDemon(fighters, cfg as DemonCfg)
        : dungeon === 'explore'
          ? runExplore(fighters, cfg as ExploreCfg)
          : dungeon === 'guard'
            ? runGuard(fighters, cfg as GuardCfg)
            : runArray(fighters, cfg as ArrayCfg)

    if (code !== '') await disbandRoom(code)
    const starterName = await myName(req.user!.id, req.user!.username)
    for (const f of fighters) {
      if (f.userId !== req.user!.id) {
        notifyUser(f.userId, {
          type: 'dungeon_result',
          dungeon,
          name: DUNGEON_NAMES[dungeon],
          by: starterName,
          win: sim.win,
          stone: sim.stone,
          herb: sim.herb,
          at: Date.now()
        })
      }
    }

    res.json({
      dungeon,
      name: DUNGEON_NAMES[dungeon],
      roomSize: fighters.length,
      win: sim.win,
      log: sim.log,
      reward: { stone: sim.stone, herb: sim.herb }
    })
  })().catch(() => res.status(500).json({ error: '副本开拔失败' }))
})

async function myName(userId: number, fallback: string): Promise<string> {
  const p = await get<{ name: string }>('SELECT name FROM profiles WHERE user_id = ?', [userId])
  return p?.name ?? fallback
}
