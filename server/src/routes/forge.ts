/**
 * 服务端权威炼器(1.58.3):强化成败、重铸词条、词条转移,全部只在服务端结算。
 *
 * 为什么:1.58.0 把**掉落**收进签发后,「已到手的那件怎么变强」仍全在客户端 ——
 * 强化是 `Math.random() < rate`、重铸的词条与 roll 全客户端掷,改几行就是必成与完美词条。
 * 现在这三件事的唯一写入口是 POST /api/forge/op:服务端从云档无头水合,
 * 跑客户端同一份纯账层(core/forge 的 upgradeOnce / core/reforge 的 reforgeOnce 与 autoReforge /
 * core/affixTransfer 的 transferOnce),把变更的整件写回云档,并把新状态记进 equip_state 台账。
 *
 * 客户端(登录态)只发请求,结果以回传的 items 为准;上传存档时装备的等级与词条不被采信,
 * 一律按台账覆盖(见 server/src/equipLedger.ts)—— 这样即便有人绕过接口直接改档也留不下来。
 */
import express, { type Request, type Response } from 'express'
import { get, run, upsertByPk } from '../db.js'
import { requireAuth } from '../auth.js'
import { metricsOf, syncProfileFromData } from './save.js'
import { loadClientModule } from '../clientVendor.js'
import { equipHoldings, recordEquipStatesFromItems } from '../equipLedger.js'
import { lootProvenance } from '../lootLedger.js'
import { recordForgeSpend } from '../forgeLedger.js'
import { withKeyLock } from '../mutex.js'
import { vipActive } from '../vip.js'
import { gnumSub } from '../gnumOps.js'

const SOURCE_MODULE = '../../../src/core/forgeResolve'
const VENDOR_FILE = 'forgeResolve'

/** core/forgeResolve 的形状;动态 import 拿到的是 any,这里把用到的字段兜死 */
interface GNumDto {
  m: number
  e: number
}

interface ForgeResultDto {
  ok: boolean
  reason: string
  op: string
  items: Record<string, unknown>[]
  spend: { stone: GNumDto; dust: number; exp: GNumDto }
  detail: Record<string, unknown>
}

/** 补册只关心申请表里的 uid;其余形状交给 core/parseForgeOp 去收口 */
type ForgeOpDto =
  | { op: 'upgrade' | 'reforge' | 'autoReforge'; uid: string }
  | { op: 'transfer'; req: { sourceUid: string; targetUid: string } }
  | { op: 'sweep' }
  | null

interface ClientForgeModule {
  resolveForgeFromSlices: (
    data: unknown,
    rawOp: unknown,
    claims: unknown,
    vip?: boolean
  ) => ForgeResultDto | null
  /** 1.79.5 新增;旧 vendor 缺这两个方法时只放弃补册,不影响正常炼器 */
  parseForgeOp?: (raw: unknown) => ForgeOpDto
  rebuildEquipFromLedgerState?: (uid: unknown, state: unknown) => Record<string, unknown> | null
}

function opUids(op: ForgeOpDto): string[] {
  if (op === null) return []
  if (op.op === 'sweep') return []
  if (op.op === 'transfer') return [op.req.sourceUid, op.req.targetUid]
  return [op.uid]
}

let cached: Promise<ClientForgeModule> | null = null

function clientForge(): Promise<ClientForgeModule> {
  // 加载失败不缓存 rejected promise:vendor 缺失/损坏是部署事故,修好后不该重启进程才恢复(1.62.0)
  cached ??= loadClientModule<ClientForgeModule>(SOURCE_MODULE, VENDOR_FILE)
  cached.catch(() => {
    cached = null
  })
  return cached
}

/**
 * 同一账号两次炼器的最小间隔。比突破(1s)宽松得多 —— 强化本就是连点动作,
 * 单次成本已由服务端算,限速只为挡高频刷接口。
 */
const OP_MIN_GAP_MS = 80
const lastOpAt = new Map<number, number>()

/** 单账号留痕节流:连点强化会刷出大量 flag,同一秒同一动作只记一条 */
const lastFlagAt = new Map<string, number>()

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 把变更的整件按 uid 原位替换回云档;顺序与其余字段都不动 */
function patchItems(data: Record<string, unknown>, changed: readonly Record<string, unknown>[]): void {
  const inv = isPlainObject(data.inventory) ? data.inventory : null
  if (inv === null || !Array.isArray(inv.items) || changed.length === 0) return
  const items = [...inv.items]
  const indexOf = new Map<string, number>()
  items.forEach((it, i) => {
    if (isPlainObject(it) && typeof it.uid === 'string') indexOf.set(it.uid, i)
  })
  for (const one of changed) {
    const uid = typeof one.uid === 'string' ? one.uid : ''
    const at = indexOf.get(uid)
    if (at !== undefined) items[at] = one
  }
  inv.items = items
}

/**
 * 料耗落档(1.79.11):石/尘的扣款从**云档现值**里减掉,随本次整档写回落库。
 *
 * 为什么:料耗原先只发生在两处 —— 客户端本地(chargeRemoteSpend,纯预测)与
 * 服务端的临时水合 store(结算完即弃),云档 resources 从不动;而下一拍心跳
 * /game/advance 的资源补丁以云档为基线,本机刚扣的钱会被它原样顶回来 ——
 * 这就是「强化/重铸/词条转移 0 消耗」的真身(1.76.0 抛弃存档后上传不再携带资源,
 * 老的 forge_spend 台账扣回链路随之断头)。修为不经此路:它随心跳上报、
 * 按「存量 + 本窗口可信产出」采信,合法的降低照单全收。
 *
 * 从云档现值扣而不是从上报余额扣:上报值可被改包抬高(灵石无持有上限),
 * 付得起照旧按上报判,但真扣的是云档的钱 —— 写回的绝不会比云档原有还多。
 */
function deductSpendFromSave(data: Record<string, unknown>, spend: ForgeResultDto['spend']): void {
  const res = isPlainObject(data.resources) ? data.resources : null
  if (res === null) return
  res.spiritStone = gnumSub(res.spiritStone, spend.stone)
  if (spend.dust > 0) {
    const dust = typeof res.dust === 'number' && Number.isFinite(res.dust) ? res.dust : 0
    res.dust = Math.max(0, dust - spend.dust)
  }
}

/**
 * 服务端补册(1.79.5):gone 表示云档里没有这件,而客户端又不再上传行囊。
 * 只有「loot_ledger 已签发 + equip_state 有完整强度」时才把它放回云档 ——
 * 两本账都是服务端写的,客户端上报的 templateId/affixes/level 一概不采信。
 * 已分解/出售的件会被动作结算从两本账清掉,所以不会借这条路径借尸还魂。
 */
async function recoverGoneEquip(
  userId: number,
  data: Record<string, unknown>,
  rawOp: unknown,
  mod: ClientForgeModule
): Promise<boolean> {
  if (mod.parseForgeOp === undefined || mod.rebuildEquipFromLedgerState === undefined) return false
  const op = mod.parseForgeOp(rawOp)
  const uids = [...new Set(opUids(op))].filter(uid => uid !== '' && uid.length <= 64)
  if (uids.length === 0) return false
  const inv = isPlainObject(data.inventory) ? data.inventory : null
  if (inv === null || !Array.isArray(inv.items)) return false

  const held = new Set<string>()
  for (const item of inv.items) {
    if (isPlainObject(item) && typeof item.uid === 'string') held.add(item.uid)
  }
  const missing = uids.filter(uid => !held.has(uid))
  if (missing.length === 0) return false

  const provenance = await lootProvenance(userId)
  if (!provenance.seeded) return false
  const holdings = await equipHoldings(userId)
  const restored: Record<string, unknown>[] = []
  for (const uid of missing) {
    if (!provenance.known.equip.has(uid)) continue
    const row = holdings.byUid.get(uid)
    if (row === undefined) continue
    const state: Record<string, unknown> = { ...row.state }
    if (state.level === undefined) state.level = row.level
    const item = mod.rebuildEquipFromLedgerState(uid, state)
    if (item !== null) restored.push(item)
  }
  if (restored.length === 0) return false
  inv.items = [...inv.items, ...restored]
  return true
}

/** 补册本身也是一次落档:即便随后因缺料被拒,这件合法的旧物也该留在云端 */
async function saveRestored(
  userId: number,
  snapshot: { version: number; data: string; updated_at: number },
  data: Record<string, unknown>
): Promise<void> {
  await upsertByPk('saves', {
    user_id: userId,
    version: snapshot.version,
    data: JSON.stringify(data),
    started: 1,
    updated_at: snapshot.updated_at
  })
  try {
    await syncProfileFromData(userId, data, Date.now())
  } catch {
    // 战力快照下一次结算会重算,不拦补册
  }
}

export const forgeRouter = express.Router()

forgeRouter.post('/forge/op', requireAuth, (req: Request, res: Response) => {
  /*
   * 与 PUT /save、突破、升级共用 `save:<uid>` 锁:一次炼器要读整档、水合重掷、再把整档写回,
   * 与自动上传或另一种结算并发时,后写的旧快照会把前一次的结果抹掉(重铸白花料、强化掉级)。
   */
  // 限速必须留在锁外:锁内判断时前一个请求已把时间桶更新过,
  // 排队进来的第二击（连点的第二发）反而会被放行,等于把限速废掉
  const gateAt = Date.now()
  if (gateAt - (lastOpAt.get(req.user!.id) ?? 0) < OP_MIN_GAP_MS) {
    res.status(429).json({ error: '操作太快,稍候再试' })
    return
  }
  lastOpAt.set(req.user!.id, gateAt)
  void withKeyLock(`save:${req.user!.id}`, async () => {
    const userId = req.user!.id
    const now = Date.now()

    const body = (isPlainObject(req.body) ? req.body : {}) as Record<string, unknown>
    const row = await get<{ version: number; data: string; updated_at: number }>(
      'SELECT version, data, updated_at FROM saves WHERE user_id = ?',
      [userId]
    )
    if (row === undefined) {
      res.status(400).json({ error: '云端还没有存档' })
      return
    }
    let data: Record<string, unknown>
    try {
      const parsed = JSON.parse(row.data) as unknown
      if (!isPlainObject(parsed)) throw new Error('bad')
      data = parsed
    } catch {
      res.status(400).json({ error: '云端存档不可读' })
      return
    }
    if (!metricsOf(row.data).started) {
      res.status(400).json({ error: '尚未开始修行' })
      return
    }

    const mod = await clientForge()
    // VIP 有效期内修行开销九折:强化/重铸/转移的价目只由服务端算,客户端那侧是预览
    const vip = await vipActive(req.user!.id)
    // 无头结算:水合 → 采信上报余额(1.73.0 起以上报为准,不拿云档垫付) → 同一套纯账层掷点
    const claims = { exp: body.exp, dust: body.dust, stone: body.stone }
    let result = mod.resolveForgeFromSlices(data, body.op, claims, vip)
    let restored = false
    if (result?.reason === 'gone') {
      restored = await recoverGoneEquip(userId, data, body.op, mod)
      if (restored) result = mod.resolveForgeFromSlices(data, body.op, claims, vip)
    }
    if (result === null) {
      if (restored) await saveRestored(userId, row, data)
      res.status(400).json({ error: '炼器申请无效' })
      return
    }
    // 被拒(满级/缺料/落位不合):一件未动、一笔未扣,只把原因回给客户端出提示。
    // 例外:刚刚补册回来的件要落库,否则下一发又报 gone(1.79.5)
    if (!result.ok) {
      if (restored) await saveRestored(userId, row, data)
      res.json({ ok: false, reason: result.reason, detail: result.detail })
      return
    }

    /*
     * 云档现值必须真够付(1.79.18):holdCapOf('stone') 恒 0 后上报余额没有天花板,
     * 结算按上报值判「付得起」,扣款却从云档现值 gnumSub 保底 0 —— 云档没钱时
     * 扣成 0 但强化照做,等于白嫖。正常玩家上报值与云档一致,行为不变。
     */
    const resNow = isPlainObject(data.resources) ? data.resources : null
    if (resNow === null || gnumSub(result.spend.stone, resNow.spiritStone).m > 0) {
      if (restored) await saveRestored(userId, row, data)
      res.json({ ok: false, reason: '灵石不足,请稍候同步后再试', detail: result.detail })
      return
    }

    patchItems(data, result.items)
    deductSpendFromSave(data, result.spend)
    // updated_at 不动:客户端锚点与冲突判定不受影响(与突破结算同规)
    await upsertByPk('saves', {
      user_id: userId,
      version: row.version,
      data: JSON.stringify(data),
      started: 1,
      updated_at: row.updated_at
    })
    // 台账是上传时的唯一凭据:签发一件就把该件的新状态记下(失败不拦本次结算,下次上传按上传值补登)
    try {
      await recordEquipStatesFromItems(userId, result.items)
    } catch {
      /* 见上 */
    }
    // 支出记账:上传存档时从资源增量里扣(扣款本身写在客户端)
    try {
      await recordForgeSpend(userId, {
        dust: result.spend.dust,
        stone: { m: result.spend.stone.m, e: result.spend.stone.e }
      })
    } catch {
      /* 记不上只是这一次不扣,不影响本次结算 */
    }
    // 战力变了,概要跟着走
    try {
      await syncProfileFromData(userId, data, now)
    } catch {
      /* 失败不动:下次上传按存档重算 */
    }
    // 留痕:同一账号同一动作一秒一条,防连点刷屏
    try {
      const key = `${userId}:${result.op}`
      if (now - (lastFlagAt.get(key) ?? 0) > 1_000) {
        lastFlagAt.set(key, now)
        const uids = result.items.map(it => (typeof it.uid === 'string' ? it.uid : '')).filter(Boolean)
        await run(
          'INSERT INTO save_flags (user_id, name, kind, detail, realm_index, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          [userId, '', 'forge', `${result.op} ${uids.join(',')}`.slice(0, 255), 0, now]
        )
      }
    } catch {
      /* 留痕失败不影响结算 */
    }
    res.json({ ok: true, op: result.op, items: result.items, spend: result.spend, detail: result.detail })
  }).catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
})
