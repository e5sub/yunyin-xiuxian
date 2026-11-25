/** 云存档 + 玩家档案快照(单份现行档,写入直接落库,不留历史副本) */
import express, { type Request, type Response } from 'express'
import { get, run, upsertByPk } from '../db.js'
import { requireAuth } from '../auth.js'
import { recomputeProfile } from '../recompute.js'
import { normalizeSaveSlices } from '../saveNormalize.js'
import { enforceAuthority } from '../saveAuthority.js'
import { enforceLootProvenance, pruneSoulBurns } from '../lootLedger.js'
import { enforceEquipStates, pruneEquipStates } from '../equipLedger.js'
import { clearPurchases, pendingSpend, settlePurchases } from '../marketLedger.js'
import { clearForgeSpend, pendingForgeSpend, settleForgeSpend } from '../forgeLedger.js'
import { clearProgressSpend, pendingProgressSpend, settleProgressSpend } from '../progressLedger.js'
import { enforceLevelStates, resetLevelStatesFromData } from '../levelLedger.js'
import { pendingSalvageCredit } from '../salvageCredit.js'
import { pendingDaoCredit } from '../daoCredit.js'
import { pruneStoneCredits, sumStoneCreditsSince } from '../stoneLedger.js'
import { clearClaims, settleClaims } from '../economyLedger.js'
import { clearSect, pendingSectSpend, readSectState, settleSectSpend } from '../sectState.js'
import { withKeyLock } from '../mutex.js'

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
  defM: number
  defE: number
}

/** 同一账号两次写档的最小间隔:客户端自动上传最快 3 秒一推,限速防改包刷写档接口 */
const WRITE_MIN_GAP_MS = 2_000

/** 每账号审计留痕默认只保留最近 10 条(写入后即修剪,见 auditSave 末尾)与抽稀间隔:自动上传最快 3 秒一推,不留抽稀会把表刷爆 */
const FLAG_KEEP = 10
const FLAG_MIN_GAP_MS = 10 * 60_000
/** 单次上传内境界跳这么多(一个大境界)就留痕:合法玩家升级是渐进的,GM 据此复核 */
const REALM_JUMP_FLAG = 100

/** 上次留痕时刻(内存即可:重启清零只会多留一条)。超量懒清,防长期运行缓慢累积 */
const lastFlagAt = new Map<number, number>()
const UID_MAP_SWEEP = 50_000

function sweepUidMap(m: Map<number, number>, now: number): void {
  if (m.size <= UID_MAP_SWEEP) return
  for (const [uid, at] of m) {
    if (now - at > 30 * 86_400_000) m.delete(uid)
  }
}

/**
 * 存档审计留痕 —— 只记不改,不拦存档。
 * 归一化修掉了什么、数值权威化压回了什么、境界有没有单次跳变,都写进 save_flags 供 GM 判定;
 * 真的在被改包的号,属性复算会把它压回真实曲线,但「谁在改」只有这里看得出来。
 */
async function auditSave(
  userId: number,
  name: string,
  realmIndex: number,
  prevRealmIndex: number,
  touched: readonly string[],
  authorityNotes: readonly string[] = []
): Promise<void> {
  const flags: Array<{ kind: string; detail: string }> = []
  if (touched.length > 0) flags.push({ kind: 'sanitized', detail: touched.join(',') })
  if (authorityNotes.length > 0) flags.push({ kind: 'authority', detail: authorityNotes.join(' | ') })
  const jump = realmIndex - prevRealmIndex
  if (prevRealmIndex > 0 && jump >= REALM_JUMP_FLAG) {
    flags.push({ kind: 'realm_jump', detail: `${prevRealmIndex}→${realmIndex}` })
  }
  if (flags.length === 0) return
  const now = Date.now()
  if (now - (lastFlagAt.get(userId) ?? 0) < FLAG_MIN_GAP_MS) return
  sweepUidMap(lastFlagAt, now)
  lastFlagAt.set(userId, now)
  for (const f of flags) {
    await run(
      'INSERT INTO save_flags (user_id, name, kind, detail, realm_index, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, name.slice(0, 64), f.kind, f.detail.slice(0, 255), realmIndex, now]
    )
  }
  await run(
    'DELETE FROM save_flags WHERE user_id = ? AND id NOT IN (SELECT id FROM (SELECT id FROM save_flags WHERE user_id = ? ORDER BY id DESC LIMIT ?) t)',
    [userId, userId, FLAG_KEEP]
  )
}

/** 属性快照钳制上限:尾数与十进制指数都远超正常玩法上限(中文单位到「极」≈e48,真仙终局 ≈e80)。
 *  上限要压得足够低才有意义 —— 钳到 e500 等于没钳:改包写 e300 照样秒杀一切服务端玩法、
 *  还能把妖王血量抬到全服打不动。e150 仍比合法天花板高出 70 个数量级,正常玩家碰不到。 */
const SNAP_MANTISSA_MAX = 1e6
const SNAP_EXP_MAX = 150
/** 合法境界上限:5 界 29 境 → major×100+sub 最高 2809;留到 3000,改包写 20000 会把副本/妖王的境界基准拉爆 */
const REALM_INDEX_MAX = 3_000
/** 快照境界与存档境界允许的偏差:快照与存档同刻生成,差超过一个大境界即视为被改 */
const REALM_SNAP_TOLERANCE = 200

/**
 * PUT /save 在云端已有档时**只接受**这三片的替换(1.78.0「抛弃存档」)。
 * 它们的共同点:不参与战力、不参与经济、不构成任何玩法进度的来源 ——
 * 换设备要跟着走的只有偏好与遥测。
 */
const PREFERENCE_SLICES = ['settings', 'diag', 'pacing'] as const

/** 客户端存档结构版本(src/utils/storage.ts 的 SAVE_VERSION):上传版本超过它即拒收。
 *  两侧一致性由 saveVersionSync.spec 钉住 —— 改客户端版本必须同步改这里。 */
const CLIENT_SAVE_VERSION = 2

/** 每账号上次写档时刻(内存即可:重启清零只影响 2 秒窗口) */
const lastWriteAt = new Map<number, number>()

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/**
 * 服务端独占字段(1.78.0):这些值的**唯一写入口**是 POST /api/action
 * (服务端在云档上跑结算,见 core/actionOps),客户端上传里出现的差异只可能是改包。
 *
 * 为什么只挑这三项:
 *   - `player.divination`:卦象是一条 StatMods(战力/产出乘区),此前由客户端掷完直写。
 *   - `endgame.souls / equippedSouls`:器魂没有签发台账,改包往数组里塞几枚顶阶魂
 *     就是一条无出处的永久战力。凝炼/装配/散去都已走动作端点。
 * 其余字段仍走 saveAuthority 的窗口钳与各本台账 —— 它们的合法增量路径
 * (坊市成交、领取奖励、弟子差事)还在客户端,不能一刀切。
 */
const SERVER_OWNED_FIELDS: Record<string, readonly string[]> = {
  player: ['divination'],
  endgame: ['souls', 'equippedSouls']
}

function objAt(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

/** 以云档(上一份落库的档)覆盖这些字段;上一份档里没有该键时跳过(老档兼容,不拿「无」清空) */
function pinServerOwned(
  data: Record<string, unknown>,
  prev: Record<string, unknown> | null
): string[] {
  const pinned: string[] = []
  if (prev === null) return pinned
  for (const [sliceId, keys] of Object.entries(SERVER_OWNED_FIELDS)) {
    const cur = objAt(data[sliceId])
    const old = objAt(prev[sliceId])
    if (cur === null || old === null) continue
    for (const key of keys) {
      if (!(key in old)) continue
      if (JSON.stringify(cur[key]) === JSON.stringify(old[key])) continue
      cur[key] = old[key]
      pinned.push(`${sliceId}.${key}`)
    }
  }
  return pinned
}

/**
 * 快照校验:字段缺失或非法按 0 兜底;name/realmLabel 兜空串。
 * 只做解析,不钳制 —— 钳制统一走 clampSnapshot(复算结果与客户端快照同一把尺)。
 */
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
    atkE: int(b.atkE),
    defM: num(b.defM),
    defE: int(b.defE)
  }
}

/**
 * 快照钳制(复算与客户端快照共用):
 *  - 指数/尾数压到合法玩法上限之外一点点(中文单位到「极」≈e48,真仙终局 ≈e80;e150 高出 70 个数量级,
 *    正常玩家碰不到 —— 改包写 e300 也到此为止,围妖/副本/擂台与妖王血量不再被天文数字污染);
 *  - 境界钳到合法上限(5 界 29 境 → 2809,留 3000);
 *  - 快照境界与存档境界(major×100+sub,同刻生成)偏差超过一个大境界即按存档收口 ——
 *    拦「低境界高攻」的快照单改(console 改 Pinia 后自动上传)。
 */
function clampSnapshot(s: ProfileSnapshot, saveRealmIndex: number, userId: number): ProfileSnapshot {
  const num = (v: number): number => Math.min(Math.max(v, 0), SNAP_MANTISSA_MAX)
  const int = (v: number): number => Math.trunc(Math.min(Math.max(v, 0), SNAP_EXP_MAX))
  const realmCeil = Math.min(saveRealmIndex + REALM_SNAP_TOLERANCE, REALM_INDEX_MAX)
  return {
    name: s.name.trim().slice(0, 24) || `道友${userId}`,
    realmLabel: s.realmLabel.slice(0, 24),
    realmIndex: Math.min(Math.max(s.realmIndex, 0), Math.max(realmCeil, 0)),
    powerM: num(s.powerM),
    powerE: int(s.powerE),
    hpM: num(s.hpM),
    hpE: int(s.hpE),
    atkM: num(s.atkM),
    atkE: int(s.atkE),
    defM: num(s.defM),
    defE: int(s.defE)
  }
}

async function upsertProfile(userId: number, s: ProfileSnapshot, now: number, rebirths?: number): Promise<void> {
  await upsertByPk('profiles', {
    user_id: userId,
    name: s.name,
    realm_label: s.realmLabel,
    realm_index: s.realmIndex,
    power_m: s.powerM,
    power_e: s.powerE,
    hp_m: s.hpM,
    hp_e: s.hpE,
    atk_m: s.atkM,
    atk_e: s.atkE,
    def_m: s.defM,
    def_e: s.defE,
    updated_at: now,
    // REPLACE INTO 会把没列出的列写回默认值:世号基线必须显式带上,否则每次上传都归零
    rebirths: rebirths ?? (await currentRebirths(userId))
  })
}

/** 已见最大世号;表里没有行(新号)按 0 */
async function currentRebirths(userId: number): Promise<number> {
  const row = await get<{ rebirths: number }>('SELECT rebirths FROM profiles WHERE user_id = ?', [userId])
  return row?.rebirths ?? 0
}

/** 复算结果字段完整性:动态模块在服务端是 any,进库前把形态兜死 */
function snapshotComplete(s: Record<string, unknown> | null): s is ProfileSnapshot & Record<string, unknown> {
  if (s === null) return false
  const keys = ['realmIndex', 'powerM', 'powerE', 'hpM', 'hpE', 'atkM', 'atkE', 'defM', 'defE'] as const
  if (!keys.every(k => finite(s[k]))) return false
  return typeof s.name === 'string' && typeof s.realmLabel === 'string'
}

/**
 * 按存档内容同步档案快照(复算优先,失败不动 profiles)。
 * 供存档被服务端单方面改写的地方共用:突破结算等 —— 这些场景 profiles 必须跟着存档走,
 * 否则权威化会把客户端境界压回旧值,突破等于白突。
 */
export async function syncProfileFromData(userId: number, data: unknown, now: number): Promise<void> {
  // 门派不进分片:复算要算它的加成,只能在这里把表里的状态一并递进去(读表,不加锁)
  const recomputed = await recomputeProfile(data, await readSectState(userId, now))
  if (!snapshotComplete(recomputed)) return
  const realmIndex = finite(recomputed.realmIndex) ? Math.trunc(recomputed.realmIndex) : 0
  await upsertProfile(userId, clampSnapshot(recomputed, realmIndex, userId), now)
}

/**
 * 从存档 JSON 里取判定用的两个指标。
 * 服务端只做「是否已开局 / 境界高低」的比较,不解析其余内容(玩法字段归客户端)。
 */
export function metricsOf(json: string): { started: boolean; realmIndex: number } {
  try {
    const data = JSON.parse(json) as Record<string, unknown>
    const game = typeof data.game === 'object' && data.game !== null ? (data.game as Record<string, unknown>) : {}
    const player = typeof data.player === 'object' && data.player !== null ? (data.player as Record<string, unknown>) : {}
    const major = finite(player.major) ? Math.trunc(player.major) : 0
    const sub = finite(player.sub) ? Math.trunc(player.sub) : 0
    return { started: game.started === true, realmIndex: major * 100 + sub }
  } catch {
    return { started: false, realmIndex: 0 }
  }
}

/** 从存档 JSON 里取世号(转世次数);缺栏按 0 */
export function rebirthsOf(json: string): number {
  try {
    return rebirthsIn(JSON.parse(json) as unknown)
  } catch {
    return 0
  }
}

/** 世号的对象版:上传链路手里就是对象,不必再序列化一遍 */
function rebirthsIn(data: unknown): number {
  const root = typeof data === 'object' && data !== null && !Array.isArray(data) ? (data as Record<string, unknown>) : {}
  const player = typeof root.player === 'object' && root.player !== null ? (root.player as Record<string, unknown>) : {}
  const reinc = typeof player.reincarnation === 'object' && player.reincarnation !== null
    ? (player.reincarnation as Record<string, unknown>)
    : {}
  return finite(reinc.count) ? Math.max(0, Math.trunc(reinc.count)) : 0
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
  /*
   * 同一账号的写档串行(进程内按 uid 排队,见 mutex.ts)。
   * 整个处理体是「读旧档 → 裁数值 → 备份 → 覆盖 → 结账本」的一次读-改-写:
   * 两个请求并发进来会各自读到同一份旧档、各自把同一批 pendingSpend 扣一遍,
   * 资源被扣两次;备份与历史也会按同一个旧档写两份。串行后这些问题一并消失。
   */
  // 写档限速放在锁外:与上一写隔太近直接 429(无论成败都计时,防 409/校验失败风暴打库)。
  // 若放进锁内,排队等待的第二发会看到「已过去很久」而被放行 —— 连点仍会双写。
  const gateAt = Date.now()
  if (gateAt - (lastWriteAt.get(req.user!.id) ?? 0) < WRITE_MIN_GAP_MS) {
    res.status(429).json({ error: '存档保存太快,稍候再试' })
    return
  }
  lastWriteAt.set(req.user!.id, gateAt)
  sweepUidMap(lastWriteAt, gateAt)

  void withKeyLock(`save:${req.user!.id}`, async () => {
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>
    const version = finite(body.version) ? Math.trunc(body.version) : 0
    // 上限与客户端 SAVE_VERSION(src/utils/storage.ts)同步,saveVersionSync.spec 钉住两者一致。
    // 放太宽的话,毒化客户端上传 version=9999 也能落库,任何存量客户端都拉不回这份档。
    if (version < 1 || version > CLIENT_SAVE_VERSION) {
      res.status(400).json({ error: '存档版本无效' })
      return
    }
    if (typeof body.data !== 'object' || body.data === null) {
      res.status(400).json({ error: '存档数据缺失' })
      return
    }
    const now = Date.now()
    /*
     * 上次落库的档先读出来:验源 / 状态台账 / 等级台账 / 数值裁决都要用它当基线
     * (1.67.0 起等级台账也要看「上次档里学过什么」,故整段提前到归一化之前)。
     */
    const old = await get<{ version: number; data: string; updated_at: number }>(
      'SELECT version, data, updated_at FROM saves WHERE user_id = ?',
      [req.user!.id]
    )
    let prevData: Record<string, unknown> | null = null
    if (old !== undefined) {
      try {
        const parsed = JSON.parse(old.data) as unknown
        prevData = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null
      } catch {
        prevData = null
      }
    }
    /*
     * ---------- 「抛弃存档」(1.78.0) ----------
     * 云端已有档时,PUT /save **不再写入任何进度**。
     *
     * 为什么:此前客户端每 20 秒把整档推上来,服务端再逐字段钳 —— 钳制的本质是
     * 「允许一段增量」,于是改包后分几次上传,每一段都落在窗口余量内,慢慢堆也能堆出
     * 改包的效果。1.78.0 把执行搬上服务端之后(/api/game/advance 与 /api/action 直接在
     * 云档上跑同一份结算代码),客户端手里那副本就只是**渲染缓存**,不再是进度载体。
     *
     * 所以这里只做一件事:把设备偏好三片(settings / diag / pacing)换成本机的。
     * 其余分片一律保留云档现值 —— 客户端传什么都不作数,「存档」这个概念到此结束。
     *
     * updated_at 故意不动:advance 的重启兜底拿它当时间锚点,在这里顶一下会把
     * 两次心跳之间的产出算丢。
     */
    if (old !== undefined) {
      const incoming = objAt(body.data)
      if (incoming === null) {
        res.status(400).json({ error: '存档数据缺失' })
        return
      }
      const merged: Record<string, unknown> = { ...(prevData ?? {}) }
      for (const id of PREFERENCE_SLICES) {
        const slice = objAt(incoming[id])
        if (slice !== null) merged[id] = slice
      }
      let prefJson: string
      try {
        prefJson = JSON.stringify(merged)
      } catch {
        res.status(400).json({ error: '存档不可序列化' })
        return
      }
      if (prefJson.length > 8 * 1024 * 1024) {
        res.status(413).json({ error: '存档过大' })
        return
      }
      await upsertByPk('saves', {
        user_id: req.user!.id,
        // 版本只认云档里那份:客户端报的 version 不参与(毒化版本号拉不回档的老坑)
        version: old.version,
        data: prefJson,
        started: metricsOf(prefJson).started ? 1 : 0,
        updated_at: old.updated_at
      })
      res.json({ ok: true, updatedAt: old.updated_at, corrections: [], preferencesOnly: true })
      return
    }

    /*
     * 落库前归一化:野装备 id、超品阶、超词条数、超强化等级、超满级功法、坏大数指数、
     * 境界越界 —— 全部按客户端读档自愈的同一套判据修平再进库。
     * 归一化失败(模块加载不了/分片畸形到链路抛错)按原样落库:加固环节不能变成拒收存档。
     */
    const normalized = await normalizeSaveSlices(body.data)
    let normalizedData = (normalized === null ? body.data : normalized.data) as Record<string, unknown>

    /*
     * 数值权威化(1.77.0 前移到播种之前):客户端上报的数值只是「提议」,落库的是服务端
     * 裁决后的结果。依次裁「境界 → 修为 → 资源 → 装备」,判据全部取自游戏自己的模型
     * (突破需求 / 每秒产速 / 每境界每小时产出 / 境界解锁层级),见 src/core/saveAuthority.ts。
     *
     * 境界基线取 profiles.realm_index 而不是上次存档:玩家删档重传时 saves 会消失,
     * profiles 不受影响 —— 否则「删档 + 重传高境界档」就是一条绕过路径。
     *
     * 1.77.0 把这一步移到**首传播种之前**:原先 loot/equip/level 三本台账在首传时
     * 按「归一化后的原始上传」整批播种,境界/资源还没过权威化 —— 新号第一次上传
     * 塞满顶阶装备与满结构功法就能一次性入账。现在先裁后播种,台账里进来的只有
     * 裁决过的值。
     */
    const prevProfileRow = await get<{ realm_index: number; rebirths: number }>(
      'SELECT realm_index, rebirths FROM profiles WHERE user_id = ?',
      [req.user!.id]
    )
    /*
     * 世号基线:profiles.rebirths。
     * 列刚加上时老档一律是 0 —— 若直接当基线,多世玩家的 count/道果/天赋会被一次性砍到「一世」的量
     * (数据事故)。所以基线为 0 且云端确有旧档时,用旧档自己的世号播种一次,与 loot_seed 同思路:
     * 只认「上一次已经落库的档」,不认本次上传 —— 否则先传一个 count=1e6 就把基线毒化了。
     * 播种值加 1000 的封顶:超过这个数本来就不是玩出来的。
     */
    // 走到这里的只可能是首传(云端有档的已在上面的「抛弃存档」分支返回并落库偏好)。
    // 首传没有旧档可播种,世号基线就取 profiles 现值。
    const prevRebirths = prevProfileRow?.rebirths ?? 0
    // 上次存档后成交、尚未在档里体现的支出:从灵石可增长量里扣(见 core/saveAuthority)
    // 坊市成交与炼器料耗两本账合成一份:两处都是「扣款在客户端,服务端只认账」
    const spend = await pendingSpend(req.user!.id)
    const forgeSpend = await pendingForgeSpend(req.user!.id)
    // 升级支出账(1.59.0):功法进修(悟道点/残页)与建筑升级(灵石/玄铁),同套机制
    const progressSpend = await pendingProgressSpend(req.user!.id)
    // 门派捐献与建派(1.68.0):门派状态不进存档,但捐献的实物是资源 —— 这笔账一样要在这里兑现,
    // 否则「捐了不扣」可以反复刷贡献。灵草按品阶分别扣(herbByGrade)。
    const sectSpend = await pendingSectSpend(req.user!.id)
    /*
     * 分解进项(1.74.1):件在上次档里有、这次的档里没有,就把它的分解返还折成尘的额度。
     * 分解是纯客户端动作,服务端只看得见「件少了、尘多了」;不给这份额度,拆一批强化件
     * 得到的尘会被尘的窗口上限当成改包压回(与 1.74.0 灵石那个 bug 同源)。
     */
    let salvageDust = 0
    try {
      salvageDust = await pendingSalvageCredit(req.user!.id, prevData, normalizedData)
    } catch {
      salvageDust = 0
    }
    /*
     * 通关道源(1.74.1):上一次档里没有、这次多出来的「通关道痕」,按该世界/试炼的结算
     * 公式上界折成道源额度。与分解尘同一条思路 —— 有出处的那部分不受窗口线夹,
     * 否则打赢一场破界的几百道源会被道源的持有上限当改包压回。
     */
    let daoCredit = 0
    try {
      daoCredit = await pendingDaoCredit(req.user!.id, prevData, normalizedData)
    } catch {
      daoCredit = 0
    }
    const authority = await enforceAuthority({
      prev: prevData,
      next: normalizedData,
      prevRealmIndex: prevProfileRow?.realm_index ?? 0,
      // 首传没有时间基线:不给「本窗口可产出」的额度,只按持有上限收
      elapsedMs: 0,
      // 首传即存量兼容路径(按持有上限收):新号第一份档不该被打回,但也进不了顶阶
      seenBefore: false,
      // 1.57.0+ 客户端标记:境界只认 profiles(唯一写入口是突破 API),上传里的 major/sub 不采信。
      // 老客户端不带标记,沿用「付得起」预算判据 —— 存量客户端与自建部署的兼容口。
      realmAuthoritative: body.realmAuth === 2,
      // 1.58.1:道果/天赋/年龄/游玩时长的乘数基线(见 core/saveAuthority 的「转世乘区」一节)
      prevRebirths,
      // 分解返还的尘(1.74.1):这几件在上次档里有、这次没有,服务端按台账里的投入复算过一次
      creditDust: salvageDust,
      // 通关道源(1.74.1):本次新增的通关道痕折出的额度,见 server/src/daoCredit
      creditDao: daoCredit,
      // 灵石进项(1.77.0):上次落库之后 op 记账的进项合计,放行窗口钳(见 server/src/stoneLedger)
      creditStone: await sumStoneCreditsSince(req.user!.id, 0),
      pendingSpend: {
        m: spend.m + forgeSpend.stone.m + progressSpend.stone.m + sectSpend.stone.m,
        e: spend.e + forgeSpend.stone.e + progressSpend.stone.e + sectSpend.stone.e,
        dust: forgeSpend.dust,
        ore: progressSpend.ore + sectSpend.ore,
        wudao: progressSpend.wudao + sectSpend.wudao,
        page: progressSpend.page,
        herb: sectSpend.herbByGrade
      }
    })
    if (authority !== null) {
      normalizedData = authority.data as Record<string, unknown>
    }

    // 服务端独占字段:只认云档(上一份落库的档),客户端上传的差异在这里被顶回
    const pinned = pinServerOwned(normalizedData, prevData)

    /*
     * 装备验源(1.58.0 掉落服务端权威化):行囊每件装备的 uid 须由签发台账(loot_ledger)发出,
     * console 造的「合法上限内神装」没有账,上传时移除并留痕。首传播种存量,删档重传不重播。
     * 放在复算之前:被移除的件不该算进战力。
     */
    const provenance = await enforceLootProvenance(req.user!.id, normalizedData)
    normalizedData = provenance.data

    /*
     * 装备状态以台账为准(1.58.3):强化/重铸/词条转移的唯一写入口是 POST /api/forge/op,
     * 签发时已把该件的等级与词条记进 equip_state。上传里自报的值与台账不符时一律按台账覆盖 ——
     * 拦的是「绕过接口直接改档」。首传播种存量(唯一一次采信客户端),删档重传不重播。
     * 台账模块不可用时按上一层结果落库:加固环节不能变成拒收存档。
     */
    let equipCorrected: string[] = []
    try {
      const equipped = await enforceEquipStates(req.user!.id, normalizedData)
      if (typeof equipped.data === 'object' && equipped.data !== null) {
        normalizedData = equipped.data as Record<string, unknown>
      }
      equipCorrected = equipped.corrected
    } catch {
      equipCorrected = []
    }

    /*
     * 等级以台账为准(1.59.1):功法进修与建筑升级的唯一写入口是 POST /api/progress/op,
     * 签发时已把新等级记进 level_state。上传里自报的等级超台账的一律按台账压回 ——
     * 拦的是「不调接口、直接在存档里塞等级」。首传播种存量(唯一一次采信客户端),删档重传不重播。
     * 台账模块不可用时按上一层结果落库:加固环节不能变成拒收存档。
     */
    /*
     * 转世时台账随档下降(1.74.1)。
     * 「只升不降」是防直注,可转世是客户端自己把灵脉点数清空、法宝重数清零、功法层数压回一层:
     * 台账不跟着降,改包只要把上一世的数值写回档里,服务端就一路放行 —— 这一世的修行等于免单。
     * 按新档原值重写台账(仅转世这一条合法降级路径),此后缺行/超行一律按新档压回。
     * 边界:同一次上传里「转世 + 把等级注满」仍会被采信一次(要堵它得让服务端复算 carry 规则);
     * 但下一次上传起,台账就钉在注满后的值上,不会再有反复利用的窗口。
     */
    if (prevData !== null && rebirthsIn(normalizedData) > rebirthsIn(prevData)) {
      try {
        await resetLevelStatesFromData(req.user!.id, normalizedData)
      } catch {
        // 台账重写失败不拦存档:下一次上传仍会按台账压回,只是这一次多放一档
      }
    }
    let levelCorrected: string[] = []
    try {
      levelCorrected = await enforceLevelStates(req.user!.id, normalizedData, prevData)
    } catch {
      levelCorrected = []
    }

    // 裁决/验源/台账覆盖都已完成,normalizedData 即落库内容
    const data = normalizedData
    let json: string
    try {
      json = JSON.stringify(data)
    } catch {
      res.status(400).json({ error: '存档不可序列化' })
      return
    }
    if (json.length > 8 * 1024 * 1024) {
      res.status(413).json({ error: '存档过大' })
      return
    }

    /*
     * 首传建档。这里**没有**「覆盖已有档」的分支 —— 云端有档的请求已在上面的
     * 「抛弃存档」处返回(只同步偏好三片)。所以不需要冲突判定、不需要留旧档备份:
     * 进度不再由客户端副本产生,也就没有「谁的档更新」这回事。
     */
    const metrics = metricsOf(json)

    await upsertByPk('saves', {
      user_id: req.user!.id,
      version,
      data: json,
      started: metrics.started ? 1 : 0,
      updated_at: now
    })
    // 快照以复算为准:用上传分片无头水合同一批 store、跑同一份 finalStats 链重算;
    // 复算失败(分片畸形/链路抛错)才回落客户端快照;两边都拿不到(老客户端不带 profile)就不动 profiles。
    // 用归一化后的 data 复算,与落库内容同源。两条路最后都过同一把钳制尺。
    const clientSnap = parseSnapshot(body.profile, req.user!.id)
    // 门派状态是服务端独占的(不在分片里),复算要算它的加成得由这里递进去
    const recomputed = await recomputeProfile(data, await readSectState(req.user!.id, now))
    if (snapshotComplete(recomputed)) {
      await upsertProfile(req.user!.id, clampSnapshot(recomputed, metrics.realmIndex, req.user!.id), now)
    } else if (clientSnap !== null) {
      await upsertProfile(req.user!.id, clampSnapshot(clientSnap, metrics.realmIndex, req.user!.id), now)
    }
    const displayName = typeof recomputed?.name === 'string' ? recomputed.name : (clientSnap?.name ?? '')
    /*
     * 世号基线只抬不降:裁决已把本次的 count 压到 prevRebirths + 1 以内,这里把它记成新的基线。
     * 必须在 upsertProfile 之后 —— REPLACE INTO 会把 rebirths 写成默认值,顺序反了基线就丢了。
     */
    const acceptedRebirths = Math.max(prevRebirths, rebirthsOf(json))
    try {
      await run('UPDATE profiles SET rebirths = ? WHERE user_id = ?', [acceptedRebirths, req.user!.id])
    } catch {
      // 基线更新失败不影响存档本身:下一次上传会重新按旧档播种
    }
    // 存档已落库:这批支出算兑现了,下一笔重新记账(清账失败只是下一份档再扣一次,不会漏)
    try {
      await settlePurchases(req.user!.id)
    } catch {
      /* 同上方:留到下一次 */
    }
    // 灵石进项账(1.77.0):进项已随本次上传落进档里,台账行清掉防膨胀(失败只多算一轮,不漏)
    try {
      await pruneStoneCredits(req.user!.id, now)
    } catch {
      /* 同上方:留到下一次 */
    }
    // 经济 op 消费账(1.77.1):卖掉的货已在本次档里少掉,临时行清掉;一次性奖励行永久保留
    try {
      await settleClaims(req.user!.id)
    } catch {
      /* 同上方:留到下一次(只是这窗口多挡一次出卖) */
    }
    try {
      await settleForgeSpend(req.user!.id)
    } catch {
      /* 同上方:留到下一次 */
    }
    try {
      await settleProgressSpend(req.user!.id)
    } catch {
      /* 同上方:留到下一次 */
    }
    try {
      await settleSectSpend(req.user!.id)
    } catch {
      /* 同上方:留到下一次 */
    }
    // 台账随行囊瘦身:分解/出售掉的件不该在表里留一辈子(失败只影响体积)
    try {
      const inv = data.inventory as { items?: unknown } | undefined
      const keep = new Set<string>()
      if (Array.isArray(inv?.items)) {
        for (const it of inv.items) {
          if (typeof it === 'object' && it !== null && typeof (it as { uid?: unknown }).uid === 'string') {
            keep.add((it as { uid: string }).uid)
          }
        }
      }
      await pruneEquipStates(req.user!.id, keep)
      // 烧炼账随行囊瘦身:凝炼的原器已随上传离手,账行清掉(失败只影响体积)
      await pruneSoulBurns(req.user!.id, keep)
    } catch {
      /* 同上 */
    }
    try {
      await auditSave(
        req.user!.id,
        displayName,
        metrics.realmIndex,
        prevProfileRow?.realm_index ?? 0,
        normalized?.touched ?? [],
        [...(authority?.notes ?? []), ...pinned.map(p => `服务端独占字段按云档覆盖(${p})`), ...equipCorrected.map(uid => `装备状态按台账覆盖(${uid})`), ...levelCorrected.map(s => `等级按台账压回:${s}`)]
      )
    } catch {
      // 留痕失败不影响存档本身
    }
    // corrections 回给客户端:被压回的字段要立刻以服务端值覆盖本地,否则玩家看到的是作弊值
    const corrections: Array<{ path: string; before: unknown; after: unknown }> = [...(authority?.corrections ?? [])]
    // 服务端独占字段也要回执:客户端本地那份是「预测」,不回执就会一直显示假卦象/假器魂
    for (const path of pinned) {
      const [slice, key] = path.split('.')
      const after = objAt(data[slice ?? ''])?.[key ?? '']
      corrections.push({ path, before: null, after })
    }
    res.json({ ok: true, updatedAt: now, corrections })
  }).catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
})

saveRouter.delete('/save', requireAuth, (req: Request, res: Response) => {
  // 与写档同一把键:删档进行中不许并发上传把旧档写回来
  void withKeyLock(`save:${req.user!.id}`, async () => {
    await run('DELETE FROM saves WHERE user_id = ?', [req.user!.id])
    // 境界基线一并归零:删档重修是合法路径,基线不归零,权威化会把新档的境界强行顶回旧值
    // 世号基线同归零:新档从第一世起算,否则「删档」会留下一个永远兑现不了的高世号
    await run("UPDATE profiles SET realm_index = 0, realm_label = '', rebirths = 0 WHERE user_id = ?", [req.user!.id])
    // 旧账不该压在新档头上(删档重修是合法路径)
    await clearPurchases(req.user!.id)
    await clearClaims(req.user!.id)
    await clearForgeSpend(req.user!.id)
    await clearProgressSpend(req.user!.id)
    /*
     * 灵石进项台账一并清(1.79.18):sumStoneCreditsSince(userId, 0) 是全历史累计,
     * 残留行会在删档重修后的首传裁决里被全额计入放行额度 —— 改包上报
     * spiritStone = 历史进项累计可越过窗口钳。与 purchases/claims 同语义随号不随档
     * 的装备/等级台账不在其列:那两本对新档只有钳制作用。
     */
    await run('DELETE FROM stone_ledger WHERE user_id = ?', [req.user!.id])
    // 门派随档一起散:删档是「重来」,建派花掉的资源不该留成一份永久属性
    await clearSect(req.user!.id)
    /*
     * 装备与等级台账不清(1.66.3):与 loot_seed/loot_ledger 同语义 —— 标记随号不随档。
     * 此前删档把 equip_seed/level_seed 一并清掉、loot_ledger 却保留:旧 uid 仍过得了验源,
     * 而状态台账回到「首传采信客户端」,改包把旧 uid 配上满强化/满词条、功法建筑注满级,
     * 删档重传即可入账 —— 且每删一次重置一次,成了可重复利用的注入链。现在台账行与
     * 播种标记都保留:新档行囊为空,孤儿行随 pruneEquipStates/pruneLoot 自然清掉;
     * 等级台账只升不降,对新档只有钳制作用,没有放水作用。
     */
    res.json({ ok: true })
  }).catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
})
