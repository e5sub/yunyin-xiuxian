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
import { metricsOf, backupBeforeOverwrite, syncProfileFromData } from './save.js'
import { loadClientModule } from '../clientVendor.js'
import { recordEquipStatesFromItems } from '../equipLedger.js'
import { recordForgeSpend } from '../forgeLedger.js'

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

interface ClientForgeModule {
  resolveForgeFromSlices: (data: unknown, rawOp: unknown, claims: unknown) => ForgeResultDto | null
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

export const forgeRouter = express.Router()

forgeRouter.post('/forge/op', requireAuth, (req: Request, res: Response) => {
  void (async () => {
    const userId = req.user!.id
    const now = Date.now()
    const last = lastOpAt.get(userId) ?? 0
    if (now - last < OP_MIN_GAP_MS) {
      res.status(429).json({ error: '操作太快,稍候再试' })
      return
    }
    lastOpAt.set(userId, now)

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
    // 无头结算:水合 → 采信不低于云档的上报余额 → 同一套纯账层掷点 → 变更件与应扣账
    const result = mod.resolveForgeFromSlices(
      data,
      body.op,
      { exp: body.exp, dust: body.dust, stone: body.stone }
    )
    if (result === null) {
      res.status(400).json({ error: '炼器申请无效' })
      return
    }
    // 被拒(满级/缺料/落位不合):一件未动、一笔未扣,只把原因回给客户端出提示
    if (!result.ok) {
      res.json({ ok: false, reason: result.reason, detail: result.detail })
      return
    }

    patchItems(data, result.items)
    try {
      await backupBeforeOverwrite(userId, { version: row.version, data: row.data, updated_at: row.updated_at })
    } catch {
      // 留档失败不拦结算
    }
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
  })().catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
})
