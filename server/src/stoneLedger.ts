/**
 * 灵石进项台账(1.77.0)。
 *
 * 1.74.0 解除灵石持有钳制后,「客户端算灵石 → 上传」的路径成了无防线口子:
 * 改包填天文数字在灵石上没有任何东西拦。收回的方式不是恢复裸钳(会误伤合法卖装余额),
 * 而是给灵石建一本**进项账**:
 *   · 客户端自算的收入(坊市卖出/悬赏/洞府巡游/成就任务/连胜/秘境)先走 op 端点,
 *     服务端按数据表复算金额、记入 stone_ledger,客户端再入账上传;
 *   · 上传裁决时灵石可增长量 = 窗口追赶(catchUp)+ 台账里「上次落库之后」的进项,
 *     没记过账的进项一律被钳回;
 *   · 服务端自己结算的进项(副本/妖王/离线/镇压等)不记账 —— 它们由服务端直接写进云档,
 *     天然构成下一次上传的「上次值」基线。
 */

/** GNum 最简形状(mantissa/exponent),与 utils/gnum 同构,路由侧不打包前端 gnum */
export interface RawGNum {
  m: number
  e: number
}

/** 记一笔进项(op 记来源,便于 GM 追数量异常);金额非法时静默丢弃 —— 0 账不值得留行 */
export async function recordStoneCredit(userId: number, op: string, amount: RawGNum): Promise<void> {
  const { run } = await import('./db.js')
  if (amount === null || typeof amount !== 'object') return
  const m = Number(amount.m)
  const e = Number(amount.e)
  if (!Number.isFinite(m) || !Number.isFinite(e) || (m === 0 && e === 0)) return
  await run('INSERT INTO stone_ledger (user_id, op, amount_m, amount_e, created_at) VALUES (?, ?, ?, ?, ?)', [
    userId,
    op.slice(0, 32),
    m,
    Math.trunc(e),
    Date.now()
  ])
}

export interface StoneCreditSum {
  m: number
  e: number
  count: number
}

/**
 * 「since 之后」的进项合计(逐行累加,不做对数合并 —— 进项行随上传窗口滚动,
 * 行数有界:每窗口内 op 次数 × 限速,清理见 pruneStoneCredits)。
 * 金额为 0 的行(理论不落)不计。
 */
export async function sumStoneCreditsSince(userId: number, sinceMs: number): Promise<StoneCreditSum> {
  const { all } = await import('./db.js')
  const rows = await all<{ amount_m: number; amount_e: number }>(
    'SELECT amount_m, amount_e FROM stone_ledger WHERE user_id = ? AND created_at > ?',
    [userId, sinceMs]
  )
  let m = 0
  let e = 0
  let count = 0
  for (const r of rows) {
    const rm = Number(r.amount_m)
    const re = Math.trunc(Number(r.amount_e))
    if (!Number.isFinite(rm) || !Number.isFinite(re) || (rm === 0 && re === 0)) continue
    if (m === 0 && e === 0) {
      m = rm
      e = re
    } else if (re === e) {
      m += rm
    } else if (re > e) {
      // 指数对齐:旧累积按 10^(re-e) 折入新指数;差距过大(>15 个数量级)的小项直接忽略
      const drop = re - e
      m = drop > 15 ? rm : rm + m / Math.pow(10, drop)
      e = re
    } else {
      const drop = e - re
      if (drop <= 15) m += rm / Math.pow(10, drop)
    }
    count += 1
  }
  // 与 gnum 的归一化同向:尾数超 1e6 就进一位;指数封顶 200(sanitize 坏档清零线 e20 的宽裕余量)
  while (m >= 1e6) {
    m /= 1000
    e += 3
  }
  if (e > 200) {
    m = 1e200
    e = 200
  }
  return { m, e, count }
}

/** 已随上传落库的进项行清掉(与 soul_burns prune 同思路,防表随年月增长) */
export async function pruneStoneCredits(userId: number, beforeMs: number): Promise<void> {
  const { run } = await import('./db.js')
  await run('DELETE FROM stone_ledger WHERE user_id = ? AND created_at <= ?', [userId, beforeMs])
}
