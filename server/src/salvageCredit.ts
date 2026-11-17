/**
 * 分解进项账(1.74.1):把「件不见了」折成尘的合法额度,交给上传裁决放行。
 *
 * 为什么需要:分解/化尘是纯客户端动作(salvage → resources.addSmall('dust')),
 * 服务端只看到两件事:件不见了、尘多了一截。而尘的持有上限按产速估(满产 720 小时),
 * 一次上传允许的增量只有上限的 5% —— 一口气拆掉一批强化过的件(返还 = 底材 +
 * 强化投入的 80%),必然越过这条线,超出部分被当改包压回,玩家看到「拆了却没涨」。
 * 灵石此前也是这个问题,1.74.0 已按运营决定整体放开;尘不能整体放开(它是炼器的
 * 硬通货,填个天文数字等于无限强化),所以改成记账:按消失的件复算返还,全额放行。
 *
 * 判据全在服务端:
 *   · 消失 = 上次落库的档里有、本次上传的档里没有(首传没有基线,不计);
 *   · 返还值取自 equip_state 台账里的权威投入(强化消耗的尘/石),不是客户端自报;
 *   · 每件只计一次(salvage_credit 表):挂单取回、档来回倒都能让同一件「消失」多次,
 *     不设这条就是「挂单 → 上传 → 取回 → 再挂单」的无限额度。
 *     代价是「先把件挂出去、再取回来拆」这一路的返还拿不到额度(极少数),
 *     换的是额度上限恒等于「把这些件真拆一遍」的合法收益,不会凭空多出来。
 *
 * 顺带覆盖:悬赏板交兵刃(bounty.deliverEquip)也是「件从行囊消失、尘多一截」,
 * 走的是同一条差集与同一份额度。它给的尘只有个位数(BOUNTY_EQUIP_DUST_BASE + 品阶),
 * 本就远低于窗口余量;这份额度只是让它在极端情形(一次交满一整批)下也不被削。
 */
import { get, run } from './db.js'
import { loadClientModule } from './clientVendor.js'
import { equipHoldings } from './equipLedger.js'

const SOURCE_MODULE = '../../src/core/salvage'
const VENDOR_FILE = 'salvage'

interface SalvageResult {
  dust: number
}

type SalvageFn = (item: Record<string, unknown>) => SalvageResult

let cached: Promise<{ salvageOf: SalvageFn }> | null = null

function clientSalvage(): Promise<{ salvageOf: SalvageFn }> {
  cached ??= loadClientModule<{ salvageOf: SalvageFn }>(SOURCE_MODULE, VENDOR_FILE)
  // 加载失败不缓存 rejected promise:vendor 缺失/损坏是部署事故,修好后不该重启进程才恢复
  cached.catch(() => {
    cached = null
  })
  return cached
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 档里行囊的全部 uid(只看 inventory.items;artifact/soul 不走分解) */
function itemUids(data: unknown): Set<string> {
  const out = new Set<string>()
  const root = isPlainObject(data) ? data : null
  const inv = root !== null && isPlainObject(root.inventory) ? root.inventory : null
  const items = inv !== null && Array.isArray(inv.items) ? inv.items : []
  for (const raw of items) {
    if (!isPlainObject(raw)) continue
    const uid = typeof raw.uid === 'string' ? raw.uid : ''
    if (uid !== '' && uid.length <= 64) out.add(uid)
  }
  return out
}

function numOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

/**
 * 复算本次上传里「消失的件」应得的尘,记进 salvage_credit 并返回合计。
 * 已记账的件、台账里没有的件、以及首传(没有上次的档)都不计 —— 宁少放不可多放。
 */
export async function pendingSalvageCredit(userId: number, prev: unknown, next: unknown): Promise<number> {
  if (!isPlainObject(prev)) return 0
  const before = itemUids(prev)
  if (before.size === 0) return 0
  const after = itemUids(next)
  const gone: string[] = []
  for (const uid of before) if (!after.has(uid)) gone.push(uid)
  if (gone.length === 0) return 0

  let mod: { salvageOf: SalvageFn }
  try {
    mod = await clientSalvage()
  } catch {
    return 0
  }
  const holdings = await equipHoldings(userId)
  const now = Date.now()
  let total = 0
  for (const uid of gone) {
    const row = holdings.byUid.get(uid)
    if (row === undefined) continue
    // 每件只计一次:主键命中即说明先前那一次消失已经折过额度
    const seen = await get<{ uid: string }>('SELECT uid FROM salvage_credit WHERE user_id = ? AND uid = ?', [userId, uid])
    if (seen !== undefined) continue
    const state = row.state
    const quality = typeof state.quality === 'string' && state.quality !== '' ? state.quality : 'common'
    let dust = 0
    try {
      const got = mod.salvageOf({
        quality,
        tier: Math.max(1, Math.trunc(numOr(state.tier, 1))),
        level: row.level,
        invested: isPlainObject(state.invested) ? state.invested : undefined
      })
      dust = Math.max(0, Math.floor(numOr(got.dust, 0)))
    } catch {
      dust = 0
    }
    await run('REPLACE INTO salvage_credit (user_id, uid, dust, created_at) VALUES (?, ?, ?, ?)', [
      userId,
      uid,
      dust,
      now
    ])
    total += dust
  }
  return total
}
