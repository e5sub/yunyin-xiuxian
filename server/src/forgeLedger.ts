/**
 * 炼器支出账(1.58.3)。
 *
 * 强化 / 重铸 / 词条转移的**料耗**由服务端复算(见 core/forgeResolve 的 spend 字段),
 * 但扣款仍写在客户端 —— 改一份存档就能「强化了但没花钱」。这里给每次动作记一行成本,
 * 上传时从「本窗口可增长量」里扣掉,扣不出来就把灵石/器灵尘压回「付得起」的位置。
 * 机制与坊市成交(marketLedger)完全一致,只是多了器灵尘一列。
 *
 * 修为不在此列:修为的持有上限远高于实际存量,记不记账都要等突破消耗才回落,
 * 免费强化白得的修为不足以改写境界裁决(境界已由突破 API 权威化)。这条边界写进 CHANGELOG。
 */
import { all, run } from './db.js'

export interface ForgeCost {
  dust: number
  stone: { m: number; e: number }
}

/** 记一笔支出(成本取服务端复算值,不信客户端报的数) */
export async function recordForgeSpend(userId: number, cost: ForgeCost): Promise<void> {
  const dust = Number.isFinite(cost.dust) && cost.dust > 0 ? Math.trunc(cost.dust) : 0
  const m = Number.isFinite(cost.stone.m) && cost.stone.m > 0 ? cost.stone.m : 0
  const e = Number.isFinite(cost.stone.e) && cost.stone.e > 0 ? Math.trunc(cost.stone.e) : 0
  if (dust === 0 && m === 0 && e === 0) return
  await run(
    'INSERT INTO forge_spend (user_id, cost_dust, cost_stone_m, cost_stone_e, settled, created_at) VALUES (?, ?, ?, ?, 0, ?)',
    [userId, dust, m, e, Date.now()]
  )
}

/** 尚未在存档里体现的支出合计 */
export async function pendingForgeSpend(userId: number): Promise<ForgeCost> {
  const rows = await all<{ cost_dust: number; cost_stone_m: number; cost_stone_e: number }>(
    'SELECT cost_dust, cost_stone_m, cost_stone_e FROM forge_spend WHERE user_id = ? AND settled = 0',
    [userId]
  )
  let dust = 0
  let m = 0
  let e = 0
  for (const r of rows) {
    dust += Number.isFinite(r.cost_dust) ? r.cost_dust : 0
    m += Number.isFinite(r.cost_stone_m) ? r.cost_stone_m : 0
    e += Number.isFinite(r.cost_stone_e) ? Math.trunc(r.cost_stone_e) : 0
    // 与 gnum 的归一化同向:尾数超 1e6 就进一位
    while (m >= 1e6) {
      m /= 1000
      e += 3
    }
  }
  return { dust: Math.trunc(dust), stone: { m, e } }
}

/** 存档已落库:这批支出算兑现了 */
export async function settleForgeSpend(userId: number): Promise<void> {
  await run('UPDATE forge_spend SET settled = 1 WHERE user_id = ? AND settled = 0', [userId])
}

/** 清账(删档时用):旧账不该压在新档头上 */
export async function clearForgeSpend(userId: number): Promise<void> {
  await run('DELETE FROM forge_spend WHERE user_id = ?', [userId])
}
