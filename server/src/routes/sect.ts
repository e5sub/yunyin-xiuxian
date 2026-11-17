/**
 * 门派:开宗立派 / 投师入派 / 审批 / 捐献 / 营造 / 技能 / 治理。
 *
 * 全部动作在服务端结算,客户端只提交「做什么」,不提交任何数值。四条不变量:
 *
 * 一、**状态只住服务端**(sects + sect_members + sect_apply,见 sectState.ts)。贡献是签发货币,
 *     技能与建筑给永久属性,放进存档就等于「本地可写」。上传存档时服务端不读客户端对门派的声明。
 * 二、**捐献必须真付**。动作前先读云档快照里的余额,减掉「上次上传后尚未兑现的捐献」再判够不够;
 *     不够就拒。记账(sect_spend)仍留一份 —— 下一次上传时 core/saveAuthority 按它扣资源可增长量。
 * 三、**计时只认服务端时钟**。工期由 core/sectRules 按目标等级算,startAt/finishAt 都写服务端时间。
 * 四、**门人是真成员**(1.69.0)。名额在山门(`memberCap = 10 + 山门等级`),只在审批那一刻卡;
 *     身份(掌门/门人)决定能不能审批、逐人、解散 —— 全都按成员表判,不信客户端自称。
 *
 * 锁:先 `save:<uid>`(捐献要读云档),再 `sect:<门派行>`(公账要串行 —— 同一笔门派库不能被两人
 * 同时花掉)。两把锁次序固定为 save → sect,不会互相等。
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
  addApply,
  addMember,
  countApplies,
  countByRole,
  countMembers,
  createSect,
  deleteSect,
  hallOfData,
  isSectRole,
  listApplies,
  listMembers,
  listSects,
  nameTaken,
  patchMember,
  pendingSectSpend,
  readApply,
  readBody,
  readMember,
  readSettledSectState,
  recordSectSpend,
  removeApply,
  removeMember,
  writeBody,
  type SectApplyView,
  type SectBriefView,
  type SectMemberRow,
  type SectRole,
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
  buildingDurationMs: (id: string, level: number, hallLevel?: number) => number | null
  buildingLevelCap: (id: string, hallLevel: number) => number
  /** 技能等级上限:基础五重,山门每 20 级再开五重(百级封顶三十重) */
  skillLevelCap: (hallLevel: number) => number
  skillCost: (id: string, level: number, rate?: number, hallLevel?: number) => number | null
  /** 某门技能现在能不能修(上一层三脉任一门到二重) */
  skillUnlocked: (skills: Record<string, number>, id: string) => boolean
  canFound: (major: number) => boolean
  canJoin: (major: number) => boolean
  donationQuota: (vip?: boolean) => number
  memberCap: (hallLevel: number) => number
  /** 一家门派同时能挂几份待审申请(data/sect 的 SECT_APPLY_MAX) */
  applyCap: () => number
  /** 职位(1.71.0):审批授权 / 逐人授权矩阵 / 副掌门与长老的名额 */
  canReviewSect: (role: SectRole | null) => boolean
  canKickSect: (actor: SectRole, target: SectRole) => boolean
  roleCap: (role: SectRole) => number | null
  /** 营造(1.72.0):有职者方可开工与收取;队列容量随山门 20/40/60/80 级各开一位 */
  canBuildSect: (role: SectRole | null) => boolean
  buildQueueCap: (hallLevel: number) => number
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

/** 正整数(门派行号 / 用户号);坏值一律 0 */
function posInt(v: unknown): number {
  const n = finiteNum(v)
  return n !== null && Number.isInteger(n) && n > 0 ? n : 0
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
async function affordable(
  userId: number,
  data: Record<string, unknown>
): Promise<{ stone: number; ore: number; wudao: number; herbOf: (grade: number) => number }> {
  const res = isPlainObject(data.resources) ? data.resources : {}
  const pending = await pendingSectSpend(userId)
  const pendingStone = gnNum(pending.stone)
  const herbs = isPlainObject(res.herbByGrade) ? res.herbByGrade : {}
  return {
    stone: Math.max(0, gnNum(res.spiritStone) - pendingStone),
    ore: Math.max(0, (finiteNum(res.ore) ?? 0) - pending.ore),
    wudao: Math.max(0, (finiteNum(res.wudao) ?? 0) - pending.wudao),
    herbOf: (grade: number) =>
      Math.max(0, (finiteNum(herbs[String(grade)]) ?? 0) - (pending.herbByGrade[String(grade)] ?? 0))
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

/** 客户端要看到的全貌:状态 + 待审申请 + 我的申请 + 可投的门派 */
interface SectView {
  state: SectState
  done: string[]
  applies: SectApplyView[]
  appliedTo: { id: number; name: string } | null
  list: SectBriefView[]
}

async function viewOf(userId: number, now: number): Promise<SectView> {
  const rules = await clientRules()
  const { state, done, member, sectRow } = await readSettledSectState(userId, now)
  if (member === null) {
    const apply = await readApply(userId)
    let appliedTo: { id: number; name: string } | null = null
    if (apply !== null) {
      const row = await readBody(apply.sect_row)
      // 门派已散(掌门的档删了而申请还挂着):给 null,界面显示「未申请」
      if (row !== null) appliedTo = { id: row.id, name: row.name }
    }
    return { state, done, applies: [], appliedTo, list: await listSects() }
  }
  return {
    state,
    done,
    // 待审申请发给有审批权的人(掌门/副掌门/长老):门人拿到的是空表,
    // 免得界面把「门外还有几个人等着」当成自己的事
    applies: isSectRole(member.role) && rules.canReviewSect(member.role) ? await listApplies(sectRow) : [],
    appliedTo: null,
    list: []
  }
}

interface ActCtx {
  userId: number
  now: number
  body: Record<string, unknown>
  state: SectState
  member: SectMemberRow | null
  sectRow: number
  rules: SectRules
  vip: boolean
}

type ActResult = { ok: true; extra?: Record<string, unknown> } | { ok: false; reason: string }

/**
 * 动作外壳:限速(锁外)→ `save:<uid>` →(在门中再加 `sect:<行>`)→ 交给 handler → 回全貌。
 * handler 自己用仓储函数落库(公账与私账分开写),外壳只负责串行、留痕与回包。
 */
function act(label: string, handler: (ctx: ActCtx) => Promise<ActResult>) {
  return (req: Request, res: Response): void => {
    const userId = req.user!.id
    const gateAt = Date.now()
    if (gateAt - (lastActAt.get(userId) ?? 0) < ACT_MIN_GAP_MS) {
      res.status(429).json({ error: '操作太快,稍候再试' })
      return
    }
    lastActAt.set(userId, gateAt)
    const body = isPlainObject(req.body) ? req.body : {}

    void withKeyLock(`save:${userId}`, async () => {
      const now = Date.now()
      const rules = await clientRules()
      /**
       * 读状态必须在**门派锁之内**:门派库是全门共用的,两个门人同时营造时
       * 「锁外读 → 等锁 → 按旧值写」会让同一笔门派库被花两遍。
       */
      const finish = async (): Promise<void> => {
        const loaded = await readSettledSectState(userId, now)
        let result: ActResult
        try {
          result = await handler({
            userId,
            now,
            body,
            state: loaded.state,
            member: loaded.member,
            sectRow: loaded.sectRow,
            rules,
            vip: await vipActive(userId)
          })
        } catch {
          // 加固链抛错按「这次没成」回:客户端本地不动,重试即可
          res.json({ ok: false, reason: 'error', now })
          return
        }
        if (!result.ok) {
          res.json({ ok: false, reason: result.reason, now })
          return
        }
        try {
          await run(
            'INSERT INTO save_flags (user_id, name, kind, detail, realm_index, created_at) VALUES (?, ?, ?, ?, ?, ?)',
            [userId, 'sect', label.slice(0, 16), '', 0, now]
          )
        } catch {
          /* 留痕失败不影响结算 */
        }
        // 重新读一遍再回:handler 改的是两张表,只有重读才能保证客户端拿到落库后的形状
        res.json({ ok: true, now, ...(await viewOf(userId, now)), ...(result.extra ?? {}) })
      }

      // 先看一眼在不在门里(只为取门派行号加锁),真正的状态在锁内再读
      const probe = await readMember(userId)
      const probeRow = probe === null ? 0 : probe.sect_row
      if (probeRow === 0) {
        await finish()
        return
      }
      await withKeyLock(`sect:${probeRow}`, async () => {
        // 等锁期间门派可能换了(刚被别家准入):按新行再加一把会引入嵌套锁,
        // 这里直接让他重来一次 —— 前端再点一下即可,不会写错账
        const rowNow = await readMember(userId)
        const nowRow = rowNow === null ? 0 : rowNow.sect_row
        if (nowRow !== 0 && nowRow !== probeRow) {
          res.json({ ok: false, reason: 'retry', now })
          return
        }
        await finish()
      })
    })
  }
}

export const sectRouter = express.Router()

/** 读门派:不写表;到点工程按服务端时钟就地结算,客户端拿到的永远是「已完工」的形状 */
sectRouter.get('/sect', requireAuth, (req: Request, res: Response) => {
  void (async () => {
    const now = Date.now()
    res.json({ ok: true, now, ...(await viewOf(req.user!.id, now)) })
  })().catch(() => {
    res.status(500).json({ error: '门派读取失败' })
  })
})

/**
 * 读门册(分页 + 按道号搜):门人可能上百,整本下发既费流量也让客户端自己切页。
 * 只读、不加锁 —— 手上的名单旧一页不算大事,动作后界面会重取。
 */
const MEMBER_PAGE_SIZE = 12
sectRouter.get('/sect/members', requireAuth, (req: Request, res: Response) => {
  void (async () => {
    const member = await readMember(req.user!.id)
    if (member === null) {
      res.json({ ok: true, members: [], total: 0, page: 1, pageSize: MEMBER_PAGE_SIZE })
      return
    }
    const q = typeof req.query.q === 'string' ? req.query.q : ''
    const asked = Number(req.query.p)
    const page = Number.isFinite(asked) && asked >= 1 ? Math.trunc(asked) : 1
    const { items, total } = await listMembers(member.sect_row, {
      q,
      offset: (page - 1) * MEMBER_PAGE_SIZE,
      limit: MEMBER_PAGE_SIZE
    })
    res.json({ ok: true, members: items, total, page, pageSize: MEMBER_PAGE_SIZE })
  })().catch(() => {
    res.status(500).json({ error: '门册读取失败' })
  })
})

/** 开宗立派:元婴境 + 一次性开销,只取名(门中三脉之法皆可修),名字二字至七字且全服唯一 */
sectRouter.post(
  '/sect/found',
  requireAuth,
  act('found', async ({ userId, now, body, state, member, rules, vip }) => {
    if (member !== null) return { ok: false, reason: 'exists' }
    const name = typeof body.name === 'string' ? body.name : ''
    if (!rules.sectNameOk(name)) return { ok: false, reason: 'badname' }
    if (!rules.canFound(await realmMajorOf(userId))) return { ok: false, reason: 'realm' }
    if (await nameTaken(name)) return { ok: false, reason: 'nameused' }
    const data = await readSave(userId)
    if (data === null) return { ok: false, reason: 'nosave' }
    const cost = rules.foundCost(vipRate(vip))
    const avail = await affordable(userId, data)
    if (avail.stone < cost.stone || avail.ore < cost.ore || avail.wudao < cost.wudao) {
      return { ok: false, reason: 'insufficient' }
    }
    const spend: SectSpend = { ...NO_SECT_SPEND, stone: gnOf(cost.stone), ore: cost.ore, wudao: cost.wudao }
    await recordSectSpend(userId, spend)
    /*
     * 建派**不送**山门等级:门人上限(初始十人)与其余建筑的余地都得自己营建出来 ——
     * 开派即十一人会让「初始十人」这句话在第一次进面板时就不成立。
     * 也不选道统:三脉合一,门中十五门技能都能修(1.69.0)。
     */
    const sectRow = await createSect({ name, leaderUid: userId, state: { ...state, name, role: 'leader' }, now })
    await addMember(userId, sectRow, 'leader', now)
    // 先前投过别家的申请随立派作废
    await removeApply(userId)
    return { ok: true, extra: { spend: cost } }
  })
)

/** 投师:提交一份申请(一人同时只挂一份;同门名额在审批时才卡) */
sectRouter.post(
  '/sect/join',
  requireAuth,
  act('join', async ({ userId, now, body, member, rules }) => {
    if (member !== null) return { ok: false, reason: 'exists' }
    const target = posInt(body.sect)
    if (target === 0) return { ok: false, reason: 'gone' }
    if (!rules.canJoin(await realmMajorOf(userId))) return { ok: false, reason: 'realm' }
    const row = await readBody(target)
    if (row === null) return { ok: false, reason: 'gone' }
    if (row.leader_uid === userId) return { ok: false, reason: 'exists' }
    const hall = hallOfData(row.data)
    if ((await countMembers(target)) >= rules.memberCap(hall)) return { ok: false, reason: 'full' }
    if ((await countApplies(target)) >= rules.applyCap()) return { ok: false, reason: 'fullapply' }
    await addApply(userId, target, now)
    return { ok: true }
  })
)

/** 撤回申请 */
sectRouter.post(
  '/sect/join/cancel',
  requireAuth,
  act('cancel', async ({ userId }) => {
    await removeApply(userId)
    return { ok: true }
  })
)

/** 掌门审批:准许 → 入册;拒绝 → 删申请(副掌门与长老也可审) */
sectRouter.post(
  '/sect/review',
  requireAuth,
  act('review', async ({ now, body, member, sectRow, state, rules }) => {
    if (member === null || !isSectRole(member.role) || !rules.canReviewSect(member.role)) {
      return { ok: false, reason: 'notleader' }
    }
    const target = posInt(body.user)
    if (target === 0 || target === member.user_id) return { ok: false, reason: 'gone' }
    const apply = await readApply(target)
    if (apply === null || apply.sect_row !== sectRow) return { ok: false, reason: 'gone' }
    if (body.approve !== true) {
      await removeApply(target)
      return { ok: true }
    }
    if (await readMember(target)) {
      // 这人已经进了别家(或已经在本门):申请作废,别再往本门塞第二笔关系
      await removeApply(target)
      return { ok: false, reason: 'joined' }
    }
    if ((await countMembers(sectRow)) >= rules.memberCap(state.buildings.hall ?? 0)) {
      return { ok: false, reason: 'full' }
    }
    await addMember(target, sectRow, 'member', now)
    await removeApply(target)
    return { ok: true }
  })
)

/** 逐出门人(掌门与副掌门;授权矩阵见 core/sectRules 的 canKickSect) */
sectRouter.post(
  '/sect/kick',
  requireAuth,
  act('kick', async ({ body, member, sectRow, rules }) => {
    if (member === null) return { ok: false, reason: 'notleader' }
    const target = posInt(body.user)
    if (target === 0 || target === member.user_id) return { ok: false, reason: 'gone' }
    const row = await readMember(target)
    if (row === null || row.sect_row !== sectRow) return { ok: false, reason: 'gone' }
    const actorRole = isSectRole(member.role) ? member.role : 'member'
    const targetRole = isSectRole(row.role) ? row.role : 'member'
    if (!rules.canKickSect(actorRole, targetRole)) return { ok: false, reason: 'notleader' }
    await removeMember(target)
    return { ok: true }
  })
)

/** 任职罢免(仅掌门):把某位门人设为副掌门/长老,或罢为门人 */
sectRouter.post(
  '/sect/role',
  requireAuth,
  act('role', async ({ body, member, sectRow, rules }) => {
    if (member === null || member.role !== 'leader') return { ok: false, reason: 'notleader' }
    const target = posInt(body.user)
    if (target === 0 || target === member.user_id) return { ok: false, reason: 'gone' }
    const want = typeof body.role === 'string' ? body.role : ''
    if (want !== 'deputy' && want !== 'elder' && want !== 'member') return { ok: false, reason: 'gone' }
    const row = await readMember(target)
    if (row === null || row.sect_row !== sectRow) return { ok: false, reason: 'gone' }
    if (row.role === want) return { ok: true } // 已是此职:幂等,不算错
    // 名额表挡超编:副掌门一位、长老四位;现任此职的这位不算在自己头上
    const cap = rules.roleCap(want as SectRole)
    if (cap !== null && (await countByRole(sectRow, want as SectRole, target)) >= cap) {
      return { ok: false, reason: 'fullrole' }
    }
    await patchMember(target, { role: want as SectRole })
    return { ok: true }
  })
)

/** 退出山门(门人;掌门得先解散或等删档转交) */
sectRouter.post(
  '/sect/leave',
  requireAuth,
  act('leave', async ({ userId, member }) => {
    if (member === null) return { ok: false, reason: 'nosect' }
    if (member.role === 'leader') return { ok: false, reason: 'isleader' }
    // 个人贡献随退门清零:不带上别家的贡献去下一家(from-scratch 的账才不会被搬运)
    await removeMember(userId)
    return { ok: true }
  })
)

/** 解散门派(掌门):门人、申请、公账一并散 */
sectRouter.post(
  '/sect/dissolve',
  requireAuth,
  act('dissolve', async ({ member, sectRow }) => {
    if (member === null || member.role !== 'leader') return { ok: false, reason: 'notleader' }
    await deleteSect(sectRow)
    return { ok: true }
  })
)

/** 捐献一次:调用方须已在 save:<uid> 与 sect:<row> 两把锁内,且 state/member 是锁内读到的数 */
async function donateOnce(
  ctx: { userId: number; now: number; state: SectState; member: SectMemberRow; sectRow: number; rules: SectRules; vip: boolean },
  kind: string
): Promise<{ ok: true; extra: Record<string, unknown> } | { ok: false; reason: string }> {
  const { userId, now, state, member, sectRow, rules, vip } = ctx
  const def = rules.donationDef(kind)
  if (def === undefined) return { ok: false, reason: 'gone' }
  const day = dayKeyOf(now)
  const today = member.day === day ? member.donations_today : 0
  if (today >= rules.donationQuota(vip)) return { ok: false, reason: 'daily' }
  const data = await readSave(userId)
  if (data === null) return { ok: false, reason: 'nosave' }
  const avail = await affordable(userId, data)
  const major = await realmMajorOf(userId)
  const grade = rules.donationHerbGrade(major)
  const enough =
    def.kind === 'stone'
      ? avail.stone >= def.amount
      : def.kind === 'ore'
        ? avail.ore >= def.amount
        : avail.herbOf(grade) >= def.amount
  if (!enough) return { ok: false, reason: 'insufficient' }
  const split = rules.donationSplit(def.contribution)
  const spend: SectSpend =
    def.kind === 'stone'
      ? { ...NO_SECT_SPEND, stone: gnOf(def.amount) }
      : def.kind === 'ore'
        ? { ...NO_SECT_SPEND, ore: def.amount }
        : { ...NO_SECT_SPEND, herbGrade: grade, herb: def.amount }
  await recordSectSpend(userId, spend)
  await patchMember(userId, {
    personal: member.personal + split.personal,
    day,
    donationsToday: today + 1,
    totalDonated: member.total_donated + def.contribution
  })
  await writeBody(sectRow, { ...state, pool: state.pool + split.pool })
  return {
    ok: true,
    extra: { spend: { kind: def.kind, amount: def.amount, grade: def.kind === 'herb' ? grade : -1 } }
  }
}

/** 捐献:三档,日限次;贡献三成入门派库(公账),其余记个人 */
sectRouter.post(
  '/sect/donate',
  requireAuth,
  act('donate', async ctx => {
    const member = ctx.member
    if (member === null) return { ok: false, reason: 'nosect' }
    return donateOnce(
      { userId: ctx.userId, now: ctx.now, state: ctx.state, member, sectRow: ctx.sectRow, rules: ctx.rules, vip: ctx.vip },
      typeof ctx.body.kind === 'string' ? ctx.body.kind : ''
    )
  })
)

/**
 * 托管自动捐献:VIP 开着「自动捐献」时,把当日名额用尽。
 *
 * **次序**:灵石 → 玄铁 → 灵草 —— 灵石是最不心疼的一档(人间界第 10 境起就长期闲置),
 * 前一档不够才退到下一档;三档都不够或名额满了就停手。
 *
 * **锁序与手动捐献完全相同**:save:<uid> → sect:<row> → 锁内重读状态。
 * 不这么做的话,「锁外读旧额度 → 等锁 → 按旧值写」会让同一笔名额捐两遍。
 * 名额是唯一的闸,连点最多把今日份捐完,不会多出贡献。
 */
export async function autoDonateFor(userId: number): Promise<number> {
  const now = Date.now()
  const rules = await clientRules()
  const vip = await vipActive(userId)
  /*
   * 锁外粗筛:托管巡检每分钟扫一遍全部开着开关的人,绝大多数早已捐满 ——
   * 先读一行成员记录判额度,不够格就不进两把锁。
   */
  const pre = await readMember(userId)
  if (pre === null) return 0
  const day = dayKeyOf(now)
  const todayPre = pre.day === day ? pre.donations_today : 0
  if (todayPre >= rules.donationQuota(vip)) return 0

  return withKeyLock(`save:${userId}`, async () => {
    const probe = await readMember(userId)
    if (probe === null) return 0
    return withKeyLock(`sect:${probe.sect_row}`, async () => {
      // 等锁期间可能被逐出/自己退了:换门了就作罢(下一分钟再来)
      const again = await readMember(userId)
      if (again === null || again.sect_row !== probe.sect_row) return 0
      let done = 0
      for (;;) {
        const { state, member, sectRow } = await readSettledSectState(userId, now)
        if (member === null) break
        const quota = rules.donationQuota(vip)
        const used = member.day === day ? member.donations_today : 0
        if (used >= quota) break
        let hit = false
        for (const kind of ['stone', 'ore', 'herb']) {
          const out = await donateOnce({ userId, now, state, member, sectRow, rules, vip }, kind)
          if (out.ok) {
            done += 1
            hit = true
            break
          }
          // 额度满:不必再试下一档
          if (out.reason === 'daily') return done
        }
        if (!hit) break
      }
      return done
    })
  })
}

/** 开工营造:扣门派库、写服务端时间;同一时刻只能有一座在造(门人也可发起 —— 公账公造) */
sectRouter.post(
  '/sect/build/start',
  requireAuth,
  act('build', async ({ now, body, state, member, sectRow, rules, vip }) => {
    if (member === null) return { ok: false, reason: 'nosect' }
    // 有职者方可营造(掌门/副掌门/长老);门人只捐贡献,不开工
    if (!isSectRole(member.role) || !rules.canBuildSect(member.role)) return { ok: false, reason: 'notauth' }
    const id = typeof body.id === 'string' ? body.id : ''
    const hall = state.buildings.hall ?? 0
    // 队列容量随山门(20/40/60/80 级各开一位);同座建筑不能同时往两处升
    if (state.build.length >= rules.buildQueueCap(hall)) return { ok: false, reason: 'busy' }
    if (state.build.some(t => t.id === id)) return { ok: false, reason: 'busy' }
    const cur = state.buildings[id] ?? 0
    const cap = rules.buildingLevelCap(id, hall)
    const cost = rules.buildingCost(id, cur, vipRate(vip))
    // 工期也吃山门减免(每级 -1%,封顶 -60%):与服务端同一把尺,见 core/sectRules 的 hallTimeRate
    const duration = rules.buildingDurationMs(id, cur, hall)
    if (cost === null || duration === null) return { ok: false, reason: 'gone' }
    if (cur + 1 > cap) return { ok: false, reason: 'cap' }
    if (state.pool < cost) return { ok: false, reason: 'pool' }
    await writeBody(sectRow, {
      ...state,
      pool: state.pool - cost,
      build: [...state.build, { id, to: cur + 1, startAt: now, finishAt: now + duration }]
    })
    return { ok: true }
  })
)

/** 收取完工:到点才收(服务端时钟);GET 已经就地结算,这一步主要为给客户端一句回执 */
sectRouter.post(
  '/sect/build/claim',
  requireAuth,
  act('claim', async ({ member, rules }) => {
    if (member === null) return { ok: false, reason: 'nosect' }
    // 收取也是有职者的事(结算在读取时已完成;这里只判权后回全貌)
    if (!isSectRole(member.role) || !rules.canBuildSect(member.role)) return { ok: false, reason: 'notauth' }
    return { ok: true }
  })
)

/** 修习技能:个人贡献;同层须上一层到 2 级。技能是门派共有的,谁出贡献谁推进 */
sectRouter.post(
  '/sect/skill/learn',
  requireAuth,
  act('skill', async ({ userId, body, state, member, sectRow, rules, vip }) => {
    if (member === null) return { ok: false, reason: 'nosect' }
    const id = typeof body.id === 'string' ? body.id : ''
    const hall = state.buildings.hall ?? 0
    const cur = state.skills[id] ?? 0
    // 上限由山门定(基础五重,每 20 级再开五重):到顶时说清是「山门未及」,不是「练满了」
    if (cur >= rules.skillLevelCap(hall)) return { ok: false, reason: 'skillcap' }
    const cost = rules.skillCost(id, cur, vipRate(vip), hall)
    if (cost === null) return { ok: false, reason: 'gone' }
    if (!rules.skillUnlocked(state.skills, id)) return { ok: false, reason: 'locked' }
    if (member.personal < cost) return { ok: false, reason: 'personal' }
    await patchMember(userId, { personal: member.personal - cost })
    await writeBody(sectRow, { ...state, skills: { ...state.skills, [id]: cur + 1 } })
    return { ok: true }
  })
)

/** 数值 → GNum(m×10^e):建派与捐灵石两处用 */
function gnOf(value: number): { m: number; e: number } {
  if (!Number.isFinite(value) || value <= 0) return { m: 0, e: 0 }
  const e = Math.floor(Math.log10(value))
  return { m: value / Math.pow(10, e), e }
}
