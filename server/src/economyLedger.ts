/**
 * 经济 op 消费对账(1.77.1)。
 *
 * `/api/economy/:op` 记的是**进项**(stone_ledger),扣货却写在客户端 —— 云端档要到下一次
 * 上传才少掉。只按「档里还剩多少」校验就能把同一批丹卖十次:每条 op 各自记一笔进项,
 * 300ms 限速等于产速,而档里的丹药直到上传前一直是满的。
 *
 * 这里补另一半:每笔 op 记「已经卖/交过多少」,校验时从档内存量里扣
 * (见 core/economyOps 的 claimed 入参),上传落库后清行(与 market_purchases 同规)。
 *
 * 一次性奖励(成就/主线/日课/连胜/巡游)记 permanent=1,永不清理 —— 同一天同一条只能领一次;
 * 日课与连胜的 key 带日键,次日自然放行。
 */
import { all, get, run, upsertByPk } from './db.js'

/** 已记过的消费/领取量:claim_key → 数量(卖出按件/株,奖励按 1) */
export async function claimedMap(userId: number): Promise<Record<string, number>> {
  const rows = await all<{ claim_key: string; qty: number }>(
    'SELECT claim_key, qty FROM economy_claims WHERE user_id = ?',
    [userId]
  )
  const out: Record<string, number> = {}
  for (const r of rows) out[r.claim_key] = Number.isFinite(r.qty) ? Math.max(0, Math.trunc(r.qty)) : 0
  return out
}

/** 记一笔消费/领取(累加;调用方须在 save:<uid> 锁内,读改写才安全) */
export async function recordClaim(userId: number, key: string, qty: number, permanent: boolean): Promise<void> {
  const add = Math.max(0, Math.trunc(qty))
  if (add === 0) return
  const cur = await get<{ qty: number; permanent: number }>(
    'SELECT qty, permanent FROM economy_claims WHERE user_id = ? AND claim_key = ?',
    [userId, key]
  )
  const prevQty = cur === undefined ? 0 : Math.max(0, Math.trunc(Number(cur.qty)))
  // 永久行不会被 settle 清掉;若同 key 先以临时行记账(卖出)后转永久,取「或」保留永久的语义
  const perm = permanent || (cur !== undefined && Number(cur.permanent) === 1)
  await upsertByPk('economy_claims', {
    user_id: userId,
    claim_key: key,
    qty: prevQty + add,
    permanent: perm ? 1 : 0,
    created_at: Date.now()
  })
}

/** 存档已落库:这批消费算在档里体现了(下一笔重新记账)。永久行留着 —— 一次性奖励不能重领 */
export async function settleClaims(userId: number): Promise<void> {
  await run('DELETE FROM economy_claims WHERE user_id = ? AND permanent = 0', [userId])
}

/** 清账(删档时用):旧账不该压在新档头上 */
export async function clearClaims(userId: number): Promise<void> {
  await run('DELETE FROM economy_claims WHERE user_id = ?', [userId])
}
