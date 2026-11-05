/**
 * 升级支出账(1.59.0)。
 *
 * 功法进修(悟道点/残页)与建筑升级(灵石/玄铁)的**价目**由服务端复算
 * (见 core/levelResolve 的 spend 字段),但扣款仍写在客户端 ——
 * 与 forge_spend(marketLedger 同套)完全一致的机制:每次动作记一行成本,
 * 上传时从「本窗口可增长量」里扣掉,扣不出来就把对应资源压回「付得起」的位置。
 * 灵石进 saveAuthority 的石账(m/e),悟道点/残页/玄铁进各自的小资源账。
 */
import { all, run } from './db.js'

export interface ProgressCost {
  stone: { m: number; e: number }
  ore: number
  wudao: number
  page: number
}

/** 记一笔支出(成本取服务端复算值,不信客户端报的数) */
export async function recordProgressSpend(userId: number, cost: ProgressCost): Promise<void> {
  const m = Number.isFinite(cost.stone.m) && cost.stone.m > 0 ? cost.stone.m : 0
  const e = Number.isFinite(cost.stone.e) && cost.stone.e > 0 ? Math.trunc(cost.stone.e) : 0
  const ore = Number.isFinite(cost.ore) && cost.ore > 0 ? Math.trunc(cost.ore) : 0
  const wudao = Number.isFinite(cost.wudao) && cost.wudao > 0 ? Math.trunc(cost.wudao) : 0
  const page = Number.isFinite(cost.page) && cost.page > 0 ? Math.trunc(cost.page) : 0
  if (m === 0 && e === 0 && ore === 0 && wudao === 0 && page === 0) return
  await run(
    'INSERT INTO progress_spend (user_id, cost_stone_m, cost_stone_e, cost_ore, cost_wudao, cost_page, settled, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)',
    [userId, m, e, ore, wudao, page, Date.now()]
  )
}

/** 尚未在存档里体现的支出合计 */
export async function pendingProgressSpend(userId: number): Promise<ProgressCost> {
  const rows = await all<{
    cost_stone_m: number
    cost_stone_e: number
    cost_ore: number
    cost_wudao: number
    cost_page: number
  }>(
    'SELECT cost_stone_m, cost_stone_e, cost_ore, cost_wudao, cost_page FROM progress_spend WHERE user_id = ? AND settled = 0',
    [userId]
  )
  let m = 0
  let e = 0
  let ore = 0
  let wudao = 0
  let page = 0
  for (const r of rows) {
    m += Number.isFinite(r.cost_stone_m) ? r.cost_stone_m : 0
    e += Number.isFinite(r.cost_stone_e) ? Math.trunc(r.cost_stone_e) : 0
    ore += Number.isFinite(r.cost_ore) ? Math.trunc(r.cost_ore) : 0
    wudao += Number.isFinite(r.cost_wudao) ? Math.trunc(r.cost_wudao) : 0
    page += Number.isFinite(r.cost_page) ? Math.trunc(r.cost_page) : 0
    // 与 gnum 的归一化同向:尾数超 1e6 就进一位
    while (m >= 1e6) {
      m /= 1000
      e += 3
    }
  }
  return { stone: { m, e }, ore: Math.trunc(ore), wudao: Math.trunc(wudao), page: Math.trunc(page) }
}

/** 存档已落库:这批支出算兑现了(兑现即删行,同 marketLedger —— settled=1 的行没人读) */
export async function settleProgressSpend(userId: number): Promise<void> {
  await run('DELETE FROM progress_spend WHERE user_id = ? AND settled = 0', [userId])
}

/** 清账(删档时用):旧账不该压在新档头上 */
export async function clearProgressSpend(userId: number): Promise<void> {
  await run('DELETE FROM progress_spend WHERE user_id = ?', [userId])
}
