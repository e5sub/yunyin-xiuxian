/**
 * 道源进项账(1.74.1):把「这次通了几个关」折成道源的合法额度,交给上传裁决放行。
 *
 * 为什么需要:道源的进项全在客户端结算(远征/试炼/挑战书/变数判胜后 addDaoSource),
 * 服务端只看得见「道源多了」。而道源的持有上限按熔炉产出估(满产 720 小时),
 * 一次上传允许的增量只有上限的 5% —— 破一次界的几百道源很容易越过这条线,
 * 超出部分被当改包压回,玩家看到的就是「打赢了却没涨」。灵石(1.74.0)与分解尘(1.74.1)
 * 是同一个病,治法也一样:按**有出处的事件**记账,不整体放开。
 *
 * 判据全在服务端:
 *   · 新增 = 上次落库的档里有、这次没有的道痕里找「通了关」的那些(首传没有基线,不计);
 *   · 一条道痕值多少道源由 `src/core/daoCredit.daoMarkCeil` 按世界/试炼的结算公式上界给,
 *     认不出的 targetId 一分不给;
 *   · 忆战重写(list 里 targetName 以「重写·」开头)不产生道源,跳过;
 *   · 每条道痕只计一次(dao_credit 表):档来回倒能让同一条痕「重新出现」,
 *     不设这条就是可以反复兑现的额度。
 *
 * 额度只放宽「本窗口能涨多少」,不往档里加钱 —— 玩家余额仍是客户端报的,
 * 有出处的部分不受窗口线夹,没出处的照旧被压回。
 */
import { get, run } from './db.js'
import { loadClientModule } from './clientVendor.js'

const SOURCE_MODULE = '../../src/core/daoCredit'
const VENDOR_FILE = 'daoCredit'

type CeilFn = (targetId: string) => number

let cached: Promise<{ daoMarkCeil: CeilFn }> | null = null

function clientDaoCredit(): Promise<{ daoMarkCeil: CeilFn }> {
  cached ??= loadClientModule<{ daoMarkCeil: CeilFn }>(SOURCE_MODULE, VENDOR_FILE)
  // 加载失败不缓存 rejected promise:vendor 缺失/损坏是部署事故,修好后不该重启进程才恢复
  cached.catch(() => {
    cached = null
  })
  return cached
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

interface MarkShape {
  targetId: string
  name: string
  cleared: boolean
  at: number
}

/** 档里 endgame.marks 的全部道痕;畸形的直接跳过(数不出出处就不给额度) */
function marksOf(data: unknown): MarkShape[] {
  const root = isPlainObject(data) ? data : null
  const endgame = root !== null && isPlainObject(root.endgame) ? root.endgame : null
  const list = endgame !== null && Array.isArray(endgame.marks) ? endgame.marks : []
  const out: MarkShape[] = []
  for (const raw of list) {
    if (!isPlainObject(raw)) continue
    const targetId = typeof raw.targetId === 'string' ? raw.targetId : ''
    if (targetId === '' || targetId.length > 64) continue
    const name = typeof raw.name === 'string' ? raw.name : ''
    const at = typeof raw.at === 'number' && Number.isFinite(raw.at) ? Math.trunc(raw.at) : 0
    out.push({ targetId, name: name.slice(0, 64), cleared: raw.cleared === true, at })
  }
  return out
}

/** 一条道痕的账键:目标 + 落地时刻 + 名字(同一刻同一目标的两条痕几乎不可能,但名字能兜住) */
function markKey(m: MarkShape): string {
  return `${m.targetId}:${m.at}:${m.name}`.slice(0, 160)
}

/**
 * 本次上传里新增的通关道痕应得的道源额度,记进 dao_credit 并返回合计。
 * 首传(没有上次的档)不计、已记账的不计、认不出目标的不计 —— 宁少放不可多放。
 */
export async function pendingDaoCredit(userId: number, prev: unknown, next: unknown): Promise<number> {
  if (!isPlainObject(prev)) return 0
  const before = new Set(marksOf(prev).map(markKey))
  const fresh = marksOf(next).filter(m => m.cleared && !m.name.startsWith('重写·') && !before.has(markKey(m)))
  if (fresh.length === 0) return 0

  let mod: { daoMarkCeil: CeilFn }
  try {
    mod = await clientDaoCredit()
  } catch {
    return 0
  }
  const now = Date.now()
  let total = 0
  for (const m of fresh) {
    const key = markKey(m)
    const seen = await get<{ mark_key: string }>('SELECT mark_key FROM dao_credit WHERE user_id = ? AND mark_key = ?', [
      userId,
      key
    ])
    if (seen !== undefined) continue
    let ceil = 0
    try {
      ceil = Math.max(0, Math.floor(mod.daoMarkCeil(m.targetId)))
    } catch {
      ceil = 0
    }
    await run('REPLACE INTO dao_credit (user_id, mark_key, credit, created_at) VALUES (?, ?, ?, ?)', [
      userId,
      key,
      ceil,
      now
    ])
    total += ceil
  }
  return total
}
