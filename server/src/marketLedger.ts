/**
 * 坊市购买账(1.58.1)。
 *
 * 坊市货架早已是确定性的(`marketSlotAt` 按 (major, stockedAt) 再生,预览与购得同一物),
 * 所以「买到的物」已经可信;不可信的是「付没付钱」—— 扣款写在客户端,改一份存档
 * 就能白拿整架。这里给每笔成交记一行成本,存档上传时从「本窗口可增长量」里扣掉,
 * 扣不出来就把灵石压回「付得起」的位置。
 *
 * 只记账、不拦购买:成交与否仍由客户端判定(卖完/过期/背包满/钱不够都在本地判),
 * 服务端只保证这些钱确实从存档里少了。
 */
import { all, run } from './db.js'

export interface Cost {
  m: number
  e: number
}

/** 记一笔成交(成本取服务端按货架复算出的价,不信客户端报的数) */
export async function recordPurchase(userId: number, cost: Cost): Promise<void> {
  const m = Number.isFinite(cost.m) && cost.m > 0 ? cost.m : 0
  const e = Number.isFinite(cost.e) && cost.e > 0 ? Math.trunc(cost.e) : 0
  if (m === 0 && e === 0) return
  await run('INSERT INTO market_purchases (user_id, cost_m, cost_e, settled, created_at) VALUES (?, ?, ?, 0, ?)', [
    userId,
    m,
    e,
    Date.now()
  ])
}

/** 尚未在存档里体现的支出合计(本次上传要从灵石增量里扣掉的部分) */
export async function pendingSpend(userId: number): Promise<Cost> {
  const rows = await all<{ cost_m: number; cost_e: number }>(
    'SELECT cost_m, cost_e FROM market_purchases WHERE user_id = ? AND settled = 0',
    [userId]
  )
  let m = 0
  let e = 0
  for (const r of rows) {
    const rm = Number.isFinite(r.cost_m) ? r.cost_m : 0
    const re = Number.isFinite(r.cost_e) ? Math.trunc(r.cost_e) : 0
    m += rm
    e += re
    // 与 gnum 的归一化同向:尾数超 1e6 就进一位
    while (m >= 1e6) {
      m /= 1000
      e += 3
    }
  }
  return { m, e }
}

/** 存档已落库:这批支出算兑现了(下一笔重新记账)。
 * 兑现即删行 —— 台账只以 settled=0 为准读/写,留着只会让表无限膨胀、热路径查询越来越慢 */
export async function settlePurchases(userId: number): Promise<void> {
  await run('DELETE FROM market_purchases WHERE user_id = ? AND settled = 0', [userId])
}

/** 清账(删档时用):旧账不该压在新档头上 */
export async function clearPurchases(userId: number): Promise<void> {
  await run('DELETE FROM market_purchases WHERE user_id = ?', [userId])
}
