/**
 * 弟子差事记账(1.74.1):派遣与收割的服务端账。
 *
 * 为什么:差事完工判定原是纯客户端(本地墙钟 + 产出自发自记)—— 改本地时间就能
 * 把一趟差事秒完,产出(草/铁/尘/悟道/灵石/丹药)白拿。现在开工时刻以服务端为
 * 准(POST /task/start),收割(POST /task/claim)须过「真实经过 ≥ 工期」这关,
 * 产出由服务端按开工时存下的 archId/spec/major/level 复算回传 —— 客户端只管入账
 * 与播报。未登录单机不受影响:store 走原来的本地路径。
 *
 * 账只记「在途」:开工 REPLACE(同 uid 重派覆盖),收割 DELETE(兑现即删,与
 * sect_spend/forge_spend 同思路)。转世清空弟子(resetForRebirth)时旧账行随下次
 * 重派覆盖或永远不被收割,不构成刷点 —— 收割必须 uid 对得上且在途。
 */
import express, { type Request, type Response } from 'express'
import { get, run, all } from '../db.js'
import { requireAuth } from '../auth.js'
import { withKeyLock } from '../mutex.js'
import { isApprenticeArch, apprenticeTaskSeconds, computeApprenticeSpoils } from '../apprenticeCore.js'

export const apprenticeRouter = express.Router()

/** 同账号差事动作最小间隔:点按类动作,300ms 不伤正常节奏 */
const OP_MIN_GAP_MS = 300
const lastOpAt = new Map<number, number>()

const MAX_MAJOR_CLAMP = 40
const MAX_LEVEL_CLAMP = 30

function clampInt(v: unknown, lo: number, hi: number): number {
  const n = Math.trunc(Number(v))
  if (!Number.isFinite(n)) return lo
  return Math.min(Math.max(n, lo), hi)
}

/** 派差:开工时刻入账。同 uid 重派覆盖旧行(本地判过「忙中不可再派」,服务端兜一层) */
apprenticeRouter.post('/apprentice/task/start', requireAuth, (req: Request, res: Response) => {
  void (async () => {
    const userId = req.user!.id
    const now = Date.now()
    if (now - (lastOpAt.get(userId) ?? 0) < OP_MIN_GAP_MS) {
      res.status(429).json({ error: '操作太快,稍候再试' })
      return
    }
    lastOpAt.set(userId, now)

    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>
    const uid = typeof body.uid === 'string' ? body.uid.slice(0, 64) : ''
    const archId = typeof body.archId === 'string' ? body.archId.slice(0, 64) : ''
    const spec = typeof body.spec === 'string' ? body.spec.slice(0, 16) : ''
    if (uid === '' || !(await isApprenticeArch(archId))) {
      res.status(400).json({ error: '差事申请无效' })
      return
    }
    const seconds = await apprenticeTaskSeconds(spec)
    if (seconds < 0) {
      res.status(400).json({ error: '差事申请无效' })
      return
    }
    /*
     * 名册对账(1.77.0):archId/level 不认客户端自报 —— 档里查无此弟子、或 archId
     * 对不上,一律拒;level/major 从云档取(产出复算的输入),改包报顶格 level=30
     * 拿顶格差事产出的路子就此封死。
     */
    const saveRow = await get<{ data: string }>('SELECT data FROM saves WHERE user_id = ?', [userId])
    let rosterLevel = 1
    let rosterMajor = 0
    if (saveRow !== undefined) {
      try {
        const data = JSON.parse(saveRow.data) as Record<string, unknown>
        const apprenticeSlice = typeof data.apprentice === 'object' && data.apprentice !== null ? (data.apprentice as Record<string, unknown>) : {}
        const roster = Array.isArray(apprenticeSlice.apprentices) ? apprenticeSlice.apprentices : []
        const mine = roster.find(
          a => typeof a === 'object' && a !== null && (a as Record<string, unknown>).uid === uid
        ) as Record<string, unknown> | undefined
        if (mine === undefined) {
          res.status(400).json({ error: '档里没有这名弟子' })
          return
        }
        if (mine.archId !== archId) {
          res.status(400).json({ error: '弟子身份对不上' })
          return
        }
        rosterLevel = clampInt(mine.level, 1, MAX_LEVEL_CLAMP)
        const player = typeof data.player === 'object' && data.player !== null ? (data.player as Record<string, unknown>) : {}
        rosterMajor = clampInt(player.major, 0, MAX_MAJOR_CLAMP)
      } catch {
        res.json({ ok: false, reason: '云档不可读' })
        return
      }
    }
    const level = rosterLevel
    const major = rosterMajor
    await run(
      'REPLACE INTO apprentice_tasks (user_id, uid, arch_id, spec, level, major, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [userId, uid, archId, spec, level, major, now]
    )
    res.json({ ok: true })
  })().catch(() => res.status(500).json({ error: '服务器异常' }))
})

/** 在途差事清单(1.74.5):离线托管由服务端代派的单,本地账里没有 —— 归来先对齐再收 */
apprenticeRouter.get('/apprentice/task/list', requireAuth, (req: Request, res: Response) => {
  void (async () => {
    const rows = await all<{ uid: string; spec: string; started_at: number }>(
      'SELECT uid, spec, started_at FROM apprentice_tasks WHERE user_id = ?',
      [req.user!.id]
    )
    const tasks: Array<{ uid: string; spec: string; startedAt: number; seconds: number }> = []
    for (const row of rows) {
      const seconds = await apprenticeTaskSeconds(row.spec)
      if (seconds < 0) continue // 认不出的 spec 不回(客户端不会派它,理论到不了这里)
      tasks.push({ uid: row.uid, spec: row.spec, startedAt: row.started_at, seconds })
    }
    res.json({ tasks })
  })().catch(() => res.status(500).json({ error: '服务器异常' }))
})

/** 收割:过工期关 → 复算产出 → 删行。并发双击由锁串行,先到者兑现,后者查无此账 */
apprenticeRouter.post('/apprentice/task/claim', requireAuth, (req: Request, res: Response) => {
  void withKeyLock(`apprentice:${req.user!.id}`, async () => {
    const userId = req.user!.id
    const now = Date.now()
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>
    const uid = typeof body.uid === 'string' ? body.uid.slice(0, 64) : ''
    if (uid === '') {
      res.status(400).json({ error: '差事申请无效' })
      return
    }
    const row = await get<{ arch_id: string; spec: string; level: number; major: number; started_at: number }>(
      'SELECT arch_id, spec, level, major, started_at FROM apprentice_tasks WHERE user_id = ? AND uid = ?',
      [userId, uid]
    )
    if (row === undefined) {
      // gone:云端没有这单在途(更新前派出的存量任务、另一台设备已收、转世清档)。
      // 这不是「再等等」能解决的 —— 客户端见到它就该把这单作废,道童回闲,不能让倒计时卡死在 00:00。
      res.json({ ok: false, reason: '没有在途的差事', gone: true })
      return
    }
    const seconds = await apprenticeTaskSeconds(row.spec)
    if (seconds < 0) {
      res.json({ ok: false, reason: '差事账不可复算' })
      return
    }
    // 工期按服务端时钟:开工到现在的真实经过。本机时钟偏快也提前不了 —— 开工时刻就是服务端记的。
    // remainMs 把服务端口径的真实剩余带回去:客户端倒计时按本地钟走,钟快几分就会先到 00:00
    // 而服务端还差着一截 —— 不带回这个数,玩家看到的就是一段纹丝不动的「约剩 00分00秒」。
    if (now - row.started_at < seconds * 1000) {
      res.json({ ok: false, reason: '尚在差中', remainMs: seconds * 1000 - (now - row.started_at) })
      return
    }
    const spoils = await computeApprenticeSpoils(row.arch_id, row.spec, row.major, row.level)
    if (spoils === null) {
      res.json({ ok: false, reason: '差事产出不可复算' })
      return
    }
    await run('DELETE FROM apprentice_tasks WHERE user_id = ? AND uid = ?', [userId, uid])
    res.json({ ok: true, spoils })
  }).catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
})
