/**
 * 门派:开宗立派 / 捐献 / 建筑营造 / 技能修习。
 *
 * 全部动作在服务端结算,客户端只提交「做什么」,不提交任何数值。三条不变量:
 *
 * 一、**状态只住服务端**(sect_state,见 sectState.ts)。贡献是签发货币,技能与建筑给永久属性,
 *     放进存档就等于「本地可写」。上传存档时服务端不读客户端对门派的声明。
 * 二、**捐献必须真付**。动作前先读云档快照里的余额,减掉「上次上传后尚未兑现的捐献」再判够不够;
 *     不够就拒。记账(sect_spend)仍留一份 —— 下一次上传时 core/saveAuthority 按它扣资源可增长量,
 *     改包填满资源也留不下来。
 * 三、**计时只认服务端时钟**。工期由 core/sectRules 按目标等级算,startAt/finishAt 都写服务端时间;
 *     客户端的倒计时只用于显示,拿它改不了完工时刻。
 *
 * 与写档共用 `save:<uid>` 锁:捐献要读 saves 快照,而上传是「读旧档 → 裁决 → 覆盖」的整段读改写,
 * 两把锁分开就会读到半截状态(记账被吞、扣款算两遍)。
 */
import express, { type Request, type Response } from 'express'
import { get, run } from '../db.js'
import { requireAuth } from '../auth.js'
import { loadClientModule } from '../clientVendor.js'
import { withKeyLock } from '../mutex.js'
import { dayKeyOf } from '../eventCore.js'
import { VIP_SPEND_RATE, vipActive } from '../vip.js'
import {
  NO_SECT_SPEND,
  pendingSectSpend,
  readSettledSectState,
  recordSectSpend,
  writeSectState,
  type SectSpend,
  type SectState
} from '../sectState.js'

const SOURCE_MODULE = '../../../src/core/sectRules'
const VENDOR_FILE = 'sectRules'

interface DonationDto {
  kind: string
  amount: number
  contribution: number
}

interface SectRules {
  sectNameOk: (raw: unknown) => boolean
  foundCost: (rate?: number) => { stone: number; ore: number; wudao: number }
  donationDef: (kind: string) => DonationDto | undefined
  donationSplit: (contribution: number) => { personal: number; pool: number }
  donationHerbGrade: (major: number) => number
  buildingCost: (id: string, level: number, rate?: number) => number | null
  buildingDurationMs: (id: string, level: number) => number | null
  buildingLevelCap: (id: string, hallLevel: number) => number
  skillCost: (id: string, level: number, rate?: number) => number | null
  skillUnlockNeed: (id: string) => { id: string; level: number } | null
  sectExists: (id: string) => boolean
  canFound: (major: number) => boolean
  donationQuota: (vip?: boolean) => number
}

let cached: Promise<SectRules> | null = null

function clientRules(): Promise<SectRules> {
  cached ??= loadClientModule<SectRules>(SOURCE_MODULE, VENDOR_FILE)
  cached.catch(() => {
    cached = null
  })
  return cached
}

/** 单账号动作最小间隔(与升级同档:价目在服务端算,限速只为挡高频刷接口) */
const ACT_MIN_GAP_MS = 200
const lastActAt = new Map<number, number>()

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function finiteNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** GNum(m×10^e)→ 数值;坏值按 0 */
function gnNum(v: unknown): number {
  if (!isPlainObject(v)) return 0
  const m = finiteNum(v.m)
  const e = finiteNum(v.e)
  if (m === null || e === null || m <= 0) return 0
  const n = m * Math.pow(10, e)
  return Number.isFinite(n) ? n : Number.MAX_VALUE
}

/** 云档快照:没有档/坏档 → null(建派与捐献都要求云档在场) */
async function readSave(userId: number): Promise<Record<string, unknown> | null> {
  const row = await get<{ data: string; started: number }>('SELECT data, started FROM saves WHERE user_id = ?', [userId])
  if (row === undefined || row.started !== 1) return null
  try {
    const parsed = JSON.parse(row.data) as unknown
    return isPlainObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** 云档里的资源余额(已扣掉尚未兑现的捐献) */
async function affordable(userId: number, data: Record<string, unknown>): Promise<{
  stone: number
  ore: number
  wudao: number
  herbOf: (grade: number) => number
}> {
  const res = isPlainObject(data.resources) ? data.resources : {}
  const pending = await pendingSectSpend(userId)
  const pendingStone = gnNum(pending.stone)
  const herbs = isPlainObject(res.herbByGrade) ? res.herbByGrade : {}
  return {
    stone: Math.max(0, gnNum(res.spiritStone) - pendingStone),
    ore: Math.max(0, (finiteNum(res.ore) ?? 0) - pending.ore),
    wudao: Math.max(0, (finiteNum(res.wudao) ?? 0) - pending.wudao),
    herbOf: (grade: number) => Math.max(0, (finiteNum(herbs[String(grade)]) ?? 0) - (pending.herbByGrade[String(grade)] ?? 0))
  }
}

/** 大境界:profiles.realm_index 是唯一权威(突破 API 写的) */
async function realmMajorOf(userId: number): Promise<number> {
  const row = await get<{ realm_index: number }>('SELECT realm_index FROM profiles WHERE user_id = ?', [userId])
  return row !== undefined && Number.isFinite(row.realm_index) ? Math.max(0, Math.trunc(row.realm_index)) : 0
}

function vipRate(vip: boolean): number {
  return vip ? VIP_SPEND_RATE : 1
}

/**
 * 动作外壳:限速(锁外)→ 读状态并结算到点工程 → 交给 handler → 有变更就落库。
 * handler 返回 null 表示「拒绝」(已写 reason),返回 state 表示成功。
 */
function act(
  req: Request,
  res: Response,
  label: string,
  handler: (ctx: {
    userId: number
    now: number
    state: SectState
    rules: SectRules
    vip: boolean
    /** 写回状态;调用方在 handler 里用它把结果落库 */
    commit: (next: SectState) => void
  }) => Promise<{ ok: true; extra?: Record<string, unknown> } | { ok: false; reason: string }>
): void {
  const gateAt = Date.now()
  if (gateAt - (lastActAt.get(req.user!.id) ?? 0) < ACT_MIN_GAP_MS) {
    res.status(429).json({ error: '操作太快,稍候再试' })
    return
  }
  lastActAt.set(req.user!.id, gateAt)

  void withKeyLock(`save:${req.user!.id}`, async () => {
    const userId = req.user!.id
    const now = Date.now()
    const rules = await clientRules()
    const current = await readSettledSectState(userId, now)
    let next: SectState | null = null
    const commit = (s: SectState): void => {
      next = s
    }
    let result: { ok: true; extra?: Record<string, unknown> } | { ok: false; reason: string }
    try {
      result = await handler({ userId, now, state: current.state, rules, vip: await vipActive(userId), commit })
    } catch {
      // 加固链抛错按「这次没成」回:客户端本地不动,重试即可
      res.json({ ok: false, reason: 'error' })
      return
    }
    if (!result.ok) {
      res.json({ ok: false, reason: result.reason })
      return
    }
    // 到点完工也要落库:GET 不写表,但动作触发的结算必须持久化,否则下次还会重算一遍
    const finalState = next ?? (current.done !== null ? current.state : null)
    if (finalState !== null) {
      await writeSectState(userId, finalState, now)
    }
    try {
      await run('INSERT INTO save_flags (user_id, name, kind, detail, realm_index, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
        userId,
        'sect',
        label.slice(0, 16),
        '',
        0,
        now
      ])
    } catch {
      /* 留痕失败不影响结算 */
    }
    // extra 回的是「本次实扣」:客户端必须按服务端算出的数扣本地(1.66.3 的支出落账铁律),
    // 不能自己按 VIP 状态重算一遍 —— 两边的 vip 判据可能差一次到期
    res.json({ ok: true, state: finalState ?? current.state, now, done: current.done, ...(result.extra ?? {}) })
  })
}

export const sectRouter = express.Router()

/** 读门派:不写表;到点工程按服务端时钟就地结算,客户端拿到的永远是「已完工」的形状 */
sectRouter.get('/sect', requireAuth, (req: Request, res: Response) => {
  void (async () => {
    const now = Date.now()
    const { state, done } = await readSettledSectState(req.user!.id, now)
    res.json({ ok: true, state, now, done })
  })().catch(() => {
    res.status(500).json({ error: '门派读取失败' })
  })
})

/** 开宗立派:元婴境 + 一次性开销,道统三选一,名字二字至七字 */
sectRouter.post('/sect/found', requireAuth, (req: Request, res: Response) => {
  const body = isPlainObject(req.body) ? req.body : {}
  act(req, res, 'found', async ({ userId, now, state, rules, vip, commit }) => {
    if (state.sectId !== null) return { ok: false, reason: 'exists' }
    const sectId = typeof body.sectId === 'string' ? body.sectId : ''
    const name = typeof body.name === 'string' ? body.name : ''
    if (!rules.sectNameOk(name)) return { ok: false, reason: 'badname' }
    // 道统须是三门之一(判据在共用数据层,不在这里抄一份 id 清单)
    if (!rules.sectExists(sectId)) return { ok: false, reason: 'gone' }
    const major = await realmMajorOf(userId)
    if (!rules.canFound(major)) return { ok: false, reason: 'realm' }
    const data = await readSave(userId)
    if (data === null) return { ok: false, reason: 'nosave' }
    const cost = rules.foundCost(vipRate(vip))
    const avail = await affordable(userId, data)
    if (avail.stone < cost.stone || avail.ore < cost.ore || avail.wudao < cost.wudao) {
      return { ok: false, reason: 'insufficient' }
    }
    const spend: SectSpend = {
      ...NO_SECT_SPEND,
      stone: gnOf(cost.stone),
      ore: cost.ore,
      wudao: cost.wudao
    }
    await recordSectSpend(userId, spend)
    commit({
      ...state,
      sectId,
      name: name.trim(),
      // 建派即有山门一级:没有山门的门派不叫门派,也给「其余建筑上限」一个起点
      buildings: { ...state.buildings, hall: Math.max(state.buildings.hall ?? 0, 1) },
      day: state.day === '' ? dayKeyOf(now) : state.day
    })
    return { ok: true, extra: { spend: cost } }
  })
})

/** 捐献:三档,日限次;贡献三成入门派库,其余记个人 */
sectRouter.post('/sect/donate', requireAuth, (req: Request, res: Response) => {
  const body = isPlainObject(req.body) ? req.body : {}
  act(req, res, 'donate', async ({ userId, now, state, rules, vip, commit }) => {
    if (state.sectId === null) return { ok: false, reason: 'nosect' }
    const def = rules.donationDef(typeof body.kind === 'string' ? body.kind : '')
    if (def === undefined) return { ok: false, reason: 'gone' }
    const day = dayKeyOf(now)
    const today = state.day === day ? state.donationsToday : 0
    if (today >= rules.donationQuota(vip)) return { ok: false, reason: 'daily' }
    const data = await readSave(userId)
    if (data === null) return { ok: false, reason: 'nosave' }
    const avail = await affordable(userId, data)
    const major = await realmMajorOf(userId)
    const grade = rules.donationHerbGrade(major)
    const enough =
      def.kind === 'stone' ? avail.stone >= def.amount : def.kind === 'ore' ? avail.ore >= def.amount : avail.herbOf(grade) >= def.amount
    if (!enough) return { ok: false, reason: 'insufficient' }
    const split = rules.donationSplit(def.contribution)
    const spend: SectSpend =
      def.kind === 'stone'
        ? { ...NO_SECT_SPEND, stone: gnOf(def.amount) }
        : def.kind === 'ore'
          ? { ...NO_SECT_SPEND, ore: def.amount }
          : { ...NO_SECT_SPEND, herbGrade: grade, herb: def.amount }
    await recordSectSpend(userId, spend)
    commit({
      ...state,
      personal: state.personal + split.personal,
      pool: state.pool + split.pool,
      totalDonated: state.totalDonated + def.contribution,
      day,
      donationsToday: today + 1
    })
    return { ok: true, extra: { spend: { kind: def.kind, amount: def.amount, grade: def.kind === 'herb' ? grade : -1 } } }
  })
})

/** 开工营造:扣门派库、写服务端时间;同一时刻只能有一座在造 */
sectRouter.post('/sect/build/start', requireAuth, (req: Request, res: Response) => {
  const body = isPlainObject(req.body) ? req.body : {}
  act(req, res, 'build', async ({ now, state, rules, vip, commit }) => {
    if (state.sectId === null) return { ok: false, reason: 'nosect' }
    const id = typeof body.id === 'string' ? body.id : ''
    if (state.build !== null) return { ok: false, reason: 'busy' }
    const cur = state.buildings[id] ?? 0
    const cap = rules.buildingLevelCap(id, state.buildings.hall ?? 0)
    const cost = rules.buildingCost(id, cur, vipRate(vip))
    const duration = rules.buildingDurationMs(id, cur)
    if (cost === null || duration === null) return { ok: false, reason: 'gone' }
    if (cur + 1 > cap) return { ok: false, reason: 'cap' }
    if (state.pool < cost) return { ok: false, reason: 'pool' }
    commit({
      ...state,
      pool: state.pool - cost,
      build: { id, to: cur + 1, startAt: now, finishAt: now + duration }
    })
    return { ok: true }
  })
})

/** 收取完工:到点才收(服务端时钟);GET 已经就地结算,这一步主要为给客户端一句回执 */
sectRouter.post('/sect/build/claim', requireAuth, (req: Request, res: Response) => {
  act(req, res, 'claim', async ({ state, commit }) => {
    if (state.sectId === null) return { ok: false, reason: 'nosect' }
    if (state.build !== null) return { ok: false, reason: 'notdone' }
    // 没有在造的工程时:上一步已经落过级,这里只回 ok(重复领取不产生任何变化)
    commit(state)
    return { ok: true }
  })
})

/** 修习技能:个人贡献;同层须上一层到 2 级 */
sectRouter.post('/sect/skill/learn', requireAuth, (req: Request, res: Response) => {
  const body = isPlainObject(req.body) ? req.body : {}
  act(req, res, 'skill', async ({ state, rules, vip, commit }) => {
    if (state.sectId === null) return { ok: false, reason: 'nosect' }
    const id = typeof body.id === 'string' ? body.id : ''
    const cur = state.skills[id] ?? 0
    const cost = rules.skillCost(id, cur, vipRate(vip))
    if (cost === null) return { ok: false, reason: 'gone' }
    const need = rules.skillUnlockNeed(id)
    if (need !== null && (state.skills[need.id] ?? 0) < need.level) return { ok: false, reason: 'locked' }
    if (state.personal < cost) return { ok: false, reason: 'personal' }
    commit({
      ...state,
      personal: state.personal - cost,
      skills: { ...state.skills, [id]: cur + 1 }
    })
    return { ok: true }
  })
})

/** 数值 → GNum(m×10^e):建派与捐灵石两处用 */
function gnOf(value: number): { m: number; e: number } {
  if (!Number.isFinite(value) || value <= 0) return { m: 0, e: 0 }
  const e = Math.floor(Math.log10(value))
  return { m: value / Math.pow(10, e), e }
}
