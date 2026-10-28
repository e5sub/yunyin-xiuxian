/** 云存档 + 玩家档案快照 */
import express, { type Request, type Response } from 'express'
import { get, run, upsertByPk } from '../db.js'
import { requireAuth } from '../auth.js'

export interface ProfileSnapshot {
  name: string
  realmLabel: string
  realmIndex: number
  powerM: number
  powerE: number
  hpM: number
  hpE: number
  atkM: number
  atkE: number
}

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/** 快照校验:字段缺失或非法按 0 兜底;name/realmLabel 兜空串 */
function parseSnapshot(raw: unknown, userId: number): ProfileSnapshot | null {
  if (typeof raw !== 'object' || raw === null) return null
  const b = raw as Record<string, unknown>
  const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '')
  const num = (v: unknown): number => (finite(v) ? v : 0)
  const int = (v: unknown): number => (finite(v) ? Math.trunc(v) : 0)
  return {
    name: str(b.name, 24) || `道友${userId}`,
    realmLabel: str(b.realmLabel, 24),
    realmIndex: int(b.realmIndex),
    powerM: num(b.powerM),
    powerE: int(b.powerE),
    hpM: num(b.hpM),
    hpE: int(b.hpE),
    atkM: num(b.atkM),
    atkE: int(b.atkE)
  }
}

export const saveRouter = express.Router()

saveRouter.get('/save', requireAuth, (req: Request, res: Response) => {
  void (async () => {
    const row = await get<{ version: number; data: string; updated_at: number }>(
      'SELECT version, data, updated_at FROM saves WHERE user_id = ?',
      [req.user!.id]
    )
    if (row === undefined) {
      res.json({ save: null })
      return
    }
    res.json({ save: { version: row.version, data: JSON.parse(row.data), updatedAt: row.updated_at } })
  })().catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
})

saveRouter.put('/save', requireAuth, (req: Request, res: Response) => {
  void (async () => {
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>
    const version = typeof body.version === 'number' && Number.isFinite(body.version) ? Math.trunc(body.version) : 0
    if (typeof body.data !== 'object' || body.data === null) {
      res.status(400).json({ error: '存档数据缺失' })
      return
    }
    const now = Date.now()
    let json: string
    try {
      json = JSON.stringify(body.data)
    } catch {
      res.status(400).json({ error: '存档不可序列化' })
      return
    }
    if (json.length > 8 * 1024 * 1024) {
      res.status(413).json({ error: '存档过大' })
      return
    }
    await upsertByPk('saves', {
      user_id: req.user!.id,
      version,
      data: json,
      updated_at: now
    })
    const snapshot = parseSnapshot(body.profile, req.user!.id)
    if (snapshot !== null) {
      await upsertByPk('profiles', {
        user_id: req.user!.id,
        name: snapshot.name,
        realm_label: snapshot.realmLabel,
        realm_index: snapshot.realmIndex,
        power_m: snapshot.powerM,
        power_e: snapshot.powerE,
        hp_m: snapshot.hpM,
        hp_e: snapshot.hpE,
        atk_m: snapshot.atkM,
        atk_e: snapshot.atkE,
        updated_at: now
      })
    }
    res.json({ ok: true, updatedAt: now })
  })().catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
})

saveRouter.delete('/save', requireAuth, (req: Request, res: Response) => {
  void (async () => {
    await run('DELETE FROM saves WHERE user_id = ?', [req.user!.id])
    res.json({ ok: true })
  })().catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
})
