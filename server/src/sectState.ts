/**
 * 门派状态(服务端独占)与捐献支出账。
 *
 * **为什么门派不进存档分片。**
 * 1.66.x 之前那些「改档换战力」的漏口,根子都在「字段可本地写」。门派要给的恰恰是永久属性
 * (技能与建筑都进 finalStats),而它的来源是一枚新货币(门派/个人贡献)。若把这份状态放进存档:
 *    · 贡献数可本地写 → 捐一次改一笔,或直接把个人贡献填到 10 万;
 *    · 建筑等级与工期可本地写 → 免贡献、免等待;
 *    · 台账只能事后压回,而「已经学到的技能」那一瞬间的收益是压不回来的。
 * 所以整份状态只住本表:客户端读 (GET /api/sect) 只拿到一份拷贝,写只提交动作
 * (建派 / 捐什么 / 升哪座 / 学哪门),算价与计时全在服务端跑 core/sectRules。
 * 上传存档时服务端**不读**客户端对门派的任何声明 —— 攻击面为零。
 *
 * **捐献怎么保证付了钱。**
 * 与 forge_spend / progress_spend 同一套:动作在服务端记账(sect_spend),扣款写在客户端。
 * 但门派多一道前置校验 —— 捐献之前先读**云档快照**里的资源余额,减去「上次上传后尚未兑现的
 * 捐献」,不够就拒。这样「余额为 0 反复捐」这条免费通道被堵住(见 routes/sect.ts 的 availableOf)。
 * 记账本身仍要留:下一次上传时 core/saveAuthority 会按这本账扣资源可增长量,
 * 改包把资源填满也留不下来。
 */
import { all, get, run, upsertByPk } from './db.js'
import { loadClientModule } from './clientVendor.js'

const SOURCE_MODULE = '../../src/core/sectRules'
const VENDOR_FILE = 'sectRules'

/**
 * 状态的线上形状(core/sectRules 的 SectState)。这里另写一份而不是 import:
 * 服务端 tsc 跟进客户端模块会把整个 src 图卷进类型检查,`@/` 别名与 DOM 差异全是假错
 * (与 saveAuthority / levelResolve 的处理一致)。
 */
export interface SectState {
  sectId: string | null
  name: string
  personal: number
  pool: number
  skills: Record<string, number>
  buildings: Record<string, number>
  build: { id: string; to: number; startAt: number; finishAt: number } | null
  day: string
  donationsToday: number
  totalDonated: number
}

interface SectRulesModule {
  normalizeSectState: (raw: unknown, now: number) => SectState
  settleBuild: (state: SectState, now: number) => { state: SectState; done: string | null }
  emptySectState: () => SectState
}

let cached: Promise<SectRulesModule> | null = null

/** 与其它权威链同规:加载失败不缓存 rejected promise(部署事故修好后不该等重启) */
function rules(): Promise<SectRulesModule> {
  cached ??= loadClientModule<SectRulesModule>(SOURCE_MODULE, VENDOR_FILE)
  cached.catch(() => {
    cached = null
  })
  return cached
}

async function emptyState(): Promise<SectState> {
  const mod = await rules()
  return mod.emptySectState()
}

async function fromRaw(raw: unknown, now: number): Promise<SectState> {
  const mod = await rules()
  return mod.normalizeSectState(raw, now)
}

/** 读原始行(不做修形);没有行 → null */
async function readRow(userId: number): Promise<{ data: string; updated_at: number } | undefined> {
  return get<{ data: string; updated_at: number }>('SELECT data, updated_at FROM sect_state WHERE user_id = ?', [userId])
}

/** 读出门派状态(已修形)。没有行 → 空状态(未建派) */
export async function readSectState(userId: number, now = Date.now()): Promise<SectState> {
  const row = await readRow(userId)
  if (row === undefined) return emptyState()
  try {
    return await fromRaw(JSON.parse(row.data) as unknown, now)
  } catch {
    // 坏行(手改库/迁移)按空状态处理;下次写入即覆盖
    return emptyState()
  }
}

/**
 * 读出并**结算到点工程**:服务端时钟过了 finishAt 就把等级落下去。
 * 返回 done 供调用方播报;需要落库时由调用方 writeSectState(读时不写,免并发读互相覆盖)。
 */
export async function readSettledSectState(
  userId: number,
  now = Date.now()
): Promise<{ state: SectState; done: string | null; exists: boolean }> {
  const row = await readRow(userId)
  if (row === undefined) return { state: await emptyState(), done: null, exists: false }
  let state: SectState
  try {
    state = await fromRaw(JSON.parse(row.data) as unknown, now)
  } catch {
    state = await emptyState()
  }
  const mod = await rules()
  const settled = mod.settleBuild(state, now)
  return { state: settled.state, done: settled.done, exists: true }
}

/** 整份写回(调用方须持 `save:<uid>` 锁) */
export async function writeSectState(userId: number, state: SectState, now = Date.now()): Promise<void> {
  // REPLACE INTO 由 db.ts 统一出方言,不在这里第二套 upsert 语法
  await upsertByPk('sect_state', { user_id: userId, data: JSON.stringify(state), updated_at: now })
}

/* ---------------- 捐献/建派支出账 ---------------- */

export interface SectSpend {
  stone: { m: number; e: number }
  ore: number
  wudao: number
  /** 灵草品阶(-1 = 本次没有灵草);一次捐献只涉及一个品阶 */
  herbGrade: number
  herb: number
}

export const NO_SECT_SPEND: SectSpend = {
  stone: { m: 0, e: 0 },
  ore: 0,
  wudao: 0,
  herbGrade: -1,
  herb: 0
}

/** 记一笔支出(成本取服务端复算值,不信客户端报的数) */
export async function recordSectSpend(userId: number, cost: SectSpend): Promise<void> {
  const m = Number.isFinite(cost.stone.m) && cost.stone.m > 0 ? cost.stone.m : 0
  const e = Number.isFinite(cost.stone.e) && cost.stone.e > 0 ? Math.trunc(cost.stone.e) : 0
  const ore = Number.isFinite(cost.ore) && cost.ore > 0 ? Math.trunc(cost.ore) : 0
  const wudao = Number.isFinite(cost.wudao) && cost.wudao > 0 ? Math.trunc(cost.wudao) : 0
  const herbGrade = Number.isFinite(cost.herbGrade) ? Math.trunc(cost.herbGrade) : -1
  const herb = Number.isFinite(cost.herb) && cost.herb > 0 ? Math.trunc(cost.herb) : 0
  if (m === 0 && e === 0 && ore === 0 && wudao === 0 && herb === 0) return
  await run(
    `INSERT INTO sect_spend (user_id, cost_stone_m, cost_stone_e, cost_ore, cost_wudao, herb_grade, cost_herb, settled, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    [userId, m, e, ore, wudao, herb > 0 ? herbGrade : -1, herb, Date.now()]
  )
}

export interface PendingSectSpend {
  stone: { m: number; e: number }
  ore: number
  wudao: number
  /** 品阶 → 尚未兑现的灵草株数 */
  herbByGrade: Record<string, number>
}

/** 尚未在存档里体现的支出合计(上传时并入 pendingSpend) */
export async function pendingSectSpend(userId: number): Promise<PendingSectSpend> {
  const rows = await all<{
    cost_stone_m: number
    cost_stone_e: number
    cost_ore: number
    cost_wudao: number
    herb_grade: number
    cost_herb: number
  }>(
    'SELECT cost_stone_m, cost_stone_e, cost_ore, cost_wudao, herb_grade, cost_herb FROM sect_spend WHERE user_id = ? AND settled = 0',
    [userId]
  )
  let m = 0
  let e = 0
  let ore = 0
  let wudao = 0
  const herbByGrade: Record<string, number> = {}
  for (const r of rows) {
    m += Number.isFinite(r.cost_stone_m) ? r.cost_stone_m : 0
    e += Number.isFinite(r.cost_stone_e) ? Math.trunc(r.cost_stone_e) : 0
    ore += Number.isFinite(r.cost_ore) ? Math.trunc(r.cost_ore) : 0
    wudao += Number.isFinite(r.cost_wudao) ? Math.trunc(r.cost_wudao) : 0
    const herb = Number.isFinite(r.cost_herb) ? Math.trunc(r.cost_herb) : 0
    if (herb > 0) {
      const key = String(Number.isFinite(r.herb_grade) && r.herb_grade >= 0 ? Math.trunc(r.herb_grade) : 1)
      herbByGrade[key] = (herbByGrade[key] ?? 0) + herb
    }
    // 与 gnum 的归一化同向:尾数超 1e6 就进一位
    while (m >= 1e6) {
      m /= 1000
      e += 3
    }
  }
  return { stone: { m, e }, ore: Math.trunc(ore), wudao: Math.trunc(wudao), herbByGrade }
}

/** 存档已落库:这批支出算兑现了(兑现即删行,与 marketLedger 同规) */
export async function settleSectSpend(userId: number): Promise<void> {
  await run('DELETE FROM sect_spend WHERE user_id = ? AND settled = 0', [userId])
}

/** 清账(删档时用):门派随档一起散,旧账不该压在新档头上 */
export async function clearSect(userId: number): Promise<void> {
  await run('DELETE FROM sect_state WHERE user_id = ?', [userId])
  await run('DELETE FROM sect_spend WHERE user_id = ?', [userId])
}
