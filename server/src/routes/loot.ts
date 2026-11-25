/**
 * 掉落签发(1.58.0):装备掉落的唯一发源地。
 *
 * 客户端只报「在哪打」(来源/层级/场数),掉不掉、掉几件、品质窗口全由服务端裁决:
 * 属性环境从云档分片复算(lootEnv),裁决与实例生成跑客户端同一份 core/lootGrant。
 * 签发出的 uid 记入台账(loot_ledger),上传存档时验源,无账之件移除 ——
 * console 里 push 一件「合法上限内神装」从此进不了档。
 */
import express, { type Request, type Response } from 'express'
import { get, upsertByPk } from '../db.js'
import { requireAuth } from '../auth.js'
import { lootEnv } from '../recompute.js'
import { grantLoot, verifyExtraGains, expectedSoulGradeOf, lootCountCaps } from '../lootGrant.js'
import { recordLoot, burnedSoulUids, recordSoulBurns, takeLootBudget } from '../lootLedger.js'
import { recordEquipStatesFromItems } from '../equipLedger.js'
import { readSectState } from '../sectState.js'
import { withKeyLock } from '../mutex.js'

export const lootRouter = express.Router()

/** 同一账号两次签发的最小间隔:历练战间隔数秒,300ms 不伤正常节奏,防高频刷接口 */
const CLAIM_MIN_GAP_MS = 300
/** 单次申请的上下文上限(离线整段结算按场次拆条,一批足够) */
const CLAIM_BATCH_MAX = 32
/** 每账号每小时签发件数上限:正常玩到不了(期望 ~10 件/时),刷接口到此为止 */
const HOURLY_GRANT_CAP = 600

const lastClaimAt = new Map<number, number>()
/** 每账号本小时已签发件数(内存即可:重启清零只放宽一次) */
const hourlyGranted = new Map<number, { hour: number; count: number }>()

function hourlyBase(userId: number): number {
  const hour = Math.floor(Date.now() / 3_600_000)
  const cur = hourlyGranted.get(userId)
  return cur && cur.hour === hour ? cur.count : 0
}

/** 查而不记:预算扣取前先看封顶放不放行(1.79.18) */
function hourlyCapOpen(userId: number, want: number): boolean {
  return hourlyBase(userId) + want <= HOURLY_GRANT_CAP
}

/** 实际签发数落账(与 underHourlyCap 原语义一致) */
function commitHourlyCap(userId: number, want: number): void {
  const hour = Math.floor(Date.now() / 3_600_000)
  hourlyGranted.set(userId, { hour, count: hourlyBase(userId) + want })
}

function underHourlyCap(userId: number, want: number): boolean {
  if (!hourlyCapOpen(userId, want)) return false
  commitHourlyCap(userId, want)
  return true
}

lootRouter.post('/loot/claim', requireAuth, (req: Request, res: Response) => {
  void (async () => {
    const userId = req.user!.id
    const now = Date.now()
    const last = lastClaimAt.get(userId) ?? 0
    if (now - last < CLAIM_MIN_GAP_MS) {
      res.status(429).json({ error: '操作太快,稍候再试' })
      return
    }
    lastClaimAt.set(userId, now)

    /*
     * 签发与落档同一把 save 锁(1.79.12):签发件此前只记台账(loot_ledger/equip_states)、
     * 回传给客户端入**本地**行囊 —— 抛弃存档之后那份入包传不上去,重登即蒸发
     * (妖王击杀赏装备是主要的活路径)。现在签发即写进云档行囊,本地入包退化为
     * 乐观显示。整段读档-签发-写档与心跳/炼器并发共用同一把锁,互不顶档。
     */
    await withKeyLock(`save:${userId}`, async () => {
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>
    const rawClaims = Array.isArray(body.claims) ? body.claims : []
    if (rawClaims.length === 0) {
      res.json({ equips: [] })
      return
    }
    if (rawClaims.length > CLAIM_BATCH_MAX) {
      res.status(400).json({ error: '单次申请过多' })
      return
    }

    // 环境属性从云档复算:客户端自报的 dropRate/luck/境界不作数
    const row = await get<{ version: number; data: string; updated_at: number; started: number }>(
      'SELECT version, data, updated_at, started FROM saves WHERE user_id = ?',
      [userId]
    )
    if (row === undefined) {
      res.json({ equips: [] })
      return
    }
    let data: unknown = null
    try {
      data = JSON.parse(row.data)
    } catch {
      res.json({ equips: [] })
      return
    }
    const env = await lootEnv(data, await readSectState(userId, now))
    if (env === null) {
      // 复算不出就不发:宁可不掉,也不按客户端自报的属性签发
      res.json({ equips: [] })
      return
    }

    const grantedBatches: Array<{ src: string; batch: Array<Record<string, unknown>> }> = []
    let want = 0
    /*
     * 件数账本收回服务端(1.74.1):suppress/offline 的 count 原是客户端自报,单次钳制
     * (SUPPRESS_COUNT_CAP/OFFLINE_COUNT_CAP)挡不住高频满额 —— 改包每 300ms 一次、
     * 一小时能签 600 件(正常期望 ~10 件/时)。现按「距上次同类结算的真实时长」推
     * 件数上限:镇压 0.4 件/时(SUPPRESS_YIELD_PER_HOUR.equipmentChance,封顶 12),
     * 离线 ~65 件/时(0.3 掉率 × ~216 胜场/时,积攒封顶 48);没有历史行的首次采信一次。
     * 一批里同 src 的多个 ctx(离线按场次拆条)共用同一份配额,按申请顺序消耗。
     */
    const caps = await lootCountCaps()
    if (caps === null) {
      res.status(500).json({ error: '签发模块不可用' })
      return
    }
    const BUDGET_LIMITS = {
      suppress: { ratePerHour: 0.4, cap: caps.SUPPRESS_COUNT_CAP },
      offline: { ratePerHour: 65, cap: 48 },
      /*
       * 客户端在场签发同样入件数账(1.77.0):battle/boss/secret/event/dungeon 此前
       * 「每请求必发 1 件」,改包每 300ms 白嫖一件顶阶装(仅受小时 600 件封顶)。
       * 现按玩法期望产速推上限 —— 历练战斗另按 12 秒一战定下限(见下),妖王/秘境/事件/副本
       * 按稀有度收紧;没有历史行的首次采信一次(与 suppress/offline 同语义)。
       */
      /*
       * 战斗间隔 12 秒(探索加速还会更短),每场翻倍至多 2 件。这里的时率只管
       * 「两拍之间不能连发」,真正的总量闸是下面 underHourlyCap 的 600 件/时 ——
       * 时率若照离线写 65/时,即使件数账修好也会把正常历练掐掉大半(飞升后尤其显眼)。
       */
      battle: { ratePerHour: 3600, cap: 48 },
      boss: { ratePerHour: 4, cap: 8 },
      secret: { ratePerHour: 6, cap: 12 },
      event: { ratePerHour: 12, cap: 24 },
      dungeon: { ratePerHour: 2, cap: 6 }
    } as const
    type BudgetSrc = keyof typeof BUDGET_LIMITS
    const ctxs = rawClaims.filter(isPlainObject)
    /**
     * 件数账的申请量。
     *
     * suppress/offline 由调用方按真实时长算好 count;而 battle/boss/secret/event/dungeon
     * 的件数由裁决核心自己掷(客户端根本报不出准确 count)。1.77.0 把这几类收进件数账时
     * 沿用了 `ctx.count ?? 0`,于是它们**每一单都被算成 0 件、整类跳过** —— 登录玩家
     * 历练赢了也一件不掉,境界越高越显眼(前期还有开局馈赠/坊市旧货撑着)。
     * 这里按「一次申请最多能出几件」在服务端补齐:翻倍战斗至多 2 件,其余各 1 件。
     * 真实件数仍由 grantEquips 掷,预算只是上限;客户端自报的 count 一概不采信。
     */
    const BUDGET_DEFAULT_WANT: Partial<Record<BudgetSrc, number>> = {
      battle: 2,
      boss: 1,
      secret: 1,
      event: 1,
      dungeon: 1
    }
    const wantOf = (src: BudgetSrc, ctx: Record<string, unknown>): number => {
      const cap = BUDGET_LIMITS[src].cap
      // 在场五类件数由服务端自计;只有镇守/离线的 count 由调用方按真实时长带来
      const fixed = BUDGET_DEFAULT_WANT[src]
      const raw = fixed ?? (typeof ctx.count === 'number' && Number.isFinite(ctx.count) ? ctx.count : 0)
      return Math.min(Math.max(Math.trunc(raw), 0), cap)
    }
    /*
     * 小时封顶先查再扣预算(1.79.18):此前 takeLootBudget 已扣账推 updated_at,
     * 循环后 underHourlyCap 超限 429 整单不发 —— 这份预算白丢,玩家明明没领到
     * 下次却被限额。先按各 src 需求上界查封顶,过了才扣预算、签发按实际数落账。
     */
    const totals = new Map<BudgetSrc, number>()
    for (const src of Object.keys(BUDGET_LIMITS) as BudgetSrc[]) {
      const total = ctxs
        .filter(c => c.src === src)
        .reduce((a, c) => a + wantOf(src, c), 0)
      if (total > 0) totals.set(src, total)
    }
    const totalsSum = [...totals.values()].reduce((a, b) => a + b, 0)
    if (totalsSum > 0 && !hourlyCapOpen(userId, totalsSum)) {
      res.status(429).json({ error: '签发过于频繁,稍候再试' })
      return
    }
    const remaining = new Map<BudgetSrc, number>()
    for (const [src, total] of totals) {
      remaining.set(src, await takeLootBudget(userId, src, total, now, BUDGET_LIMITS[src]))
    }
    for (const ctx of ctxs) {
      const srcKey = typeof ctx.src === 'string' && ctx.src in BUDGET_LIMITS ? (ctx.src as BudgetSrc) : null
      if (srcKey !== null) {
        const req = wantOf(srcKey, ctx)
        const allow = remaining.get(srcKey) ?? 0
        const grant = Math.min(req, allow)
        remaining.set(srcKey, allow - grant)
        ctx.count = grant
        if (grant === 0) continue
      }
      const granted = await grantLoot(ctx, env)
      if (granted === null) continue
      const batch: Array<Record<string, unknown>> = []
      for (const inst of granted.equips) {
        if (isPlainObject(inst) && typeof inst.uid === 'string') batch.push(inst)
      }
      if (batch.length > 0) {
        grantedBatches.push({ src: String(ctx.src ?? '').slice(0, 16), batch })
        want += batch.length
      }
    }
    if (want > 0) commitHourlyCap(userId, want)
    const equips: Array<Record<string, unknown>> = []
    for (const { src, batch } of grantedBatches) {
      await recordLoot(userId, batch.map(e => String(e.uid)), src)
      equips.push(...batch)
    }
    /*
     * 签发时同步入装备状态台账(1.66.2):uid 台账只保「这件存在」,状态台账保「这件长什么样」。
     * 原先状态行要等首次上传才按客户端自报补登 —— 签发到上传之间改包把件改满(等级/词条/品质)
     * 会被照单入账,台账的「覆盖」对新件形同虚设。服务端自己生成的实例自己记,上传时按台账覆盖。
     * 记账失败不影响签发:宁少一道锁,不可不发掉落。
     */
    if (equips.length > 0) {
      try {
        await recordEquipStatesFromItems(userId, equips)
      } catch {
        /* 状态入账失败时回退到旧行为:首次上传补登 */
      }
    }
    /*
     * 签发件写进云档行囊(1.79.12):台账只保「这件存在」,云档行囊才是玩家下次登录
     * 看得见的那一份 —— 不写就是签发即蒸发。写失败不拦回包:台账仍在,重登后客户端
     * 行囊缺件时按签发行补齐的旧链路(残页)仍在;宁少显示,不发双份。
     */
    if (equips.length > 0 && isPlainObject(data) && isPlainObject((data as Record<string, unknown>).inventory)) {
      try {
        const saveData = data as Record<string, unknown>
        const inv = saveData.inventory as Record<string, unknown>
        const items = Array.isArray(inv.items) ? (inv.items as unknown[]) : []
        inv.items = [...items, ...equips]
        await upsertByPk('saves', {
          user_id: userId,
          version: row.version,
          data: JSON.stringify(saveData),
          started: row.started,
          updated_at: row.updated_at
        })
      } catch {
        /* 行囊写不进只是这件白签,下次结算同样口径再签 */
      }
    }
    res.json({ equips })
    })
  })().catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
})

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * 法宝与器魂签发(1.58.1;器魂品阶服务端复算 1.66.3)。
 *
 * 这两类物件不是「掉落流程」的一部分:法宝掉不掉在战斗/际遇里掷,器魂由「烧一件凡器」凝出 ——
 * 所以服务端不重新掷点,只做**存在性**与**归属**两件事:数据表里确有其物(validateExtraGains)、
 * 记进台账后上传才不会被验源移除。法宝的自报 defId 按存在性钳制;器魂的自报品阶在 1.66.3 起
 * 不再照单全收 —— 客户端须带被烧装备的 uid,服务端按云档里这件的品质复算品阶
 * (与 core/soulForge 的 previewSoul 同一条映射),复算不出或原器已烧过一律不签。
 * 不带 burnedUid 的申请一律不签(旧「自报品阶」兼容口已于 1.74.2 删除)。
 *
 * 与 /loot/claim 共用同一套限速与小时封顶:签发流量不因多开一个口子而放大。
 *
 * 处理体按账号串行(1.66.3 专项扫描第二轮):烧炼账的「查过没有 → 记账」若不串行,
 * 两个并发请求带同一个 burnedUid 都能在查账时看到「没烧过」,一件装备刷出两枚魂。
 */
lootRouter.post('/loot/extras', requireAuth, (req: Request, res: Response) => {
  const userId = req.user!.id
  const now = Date.now()
  const last = lastClaimAt.get(userId) ?? 0
  if (now - last < CLAIM_MIN_GAP_MS) {
    res.status(429).json({ error: '操作太快,稍候再试' })
    return
  }
  lastClaimAt.set(userId, now)

  void withKeyLock(`loot:${userId}`, async () => {

    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>
    const gains = await verifyExtraGains(body)
    if (gains === null) {
      res.json({ artifacts: [], souls: [] })
      return
    }

    /*
     * 器魂品阶复算:带 burnedUid 的申请,原器必须在云档行囊里、品质必须可复算、
     * 且这一件没烧过(soul_burns 台账)。三条有一条不满足就不签 —— 凝炼客户端会退款
     * 并保留原器,宁可白点一次,不发无据之魂。
     */
    const souls: Array<{ uid: string; type: string; grade: number; burnedUid?: string }> = []
    const burnedNow: string[] = []
    const claimedSouls = gains.souls
    const withBurn = claimedSouls.filter(s => typeof s.burnedUid === 'string' && s.burnedUid !== '')
    if (withBurn.length > 0) {
      let saveItems: Array<Record<string, unknown>> | null = null
      try {
        const row = await get<{ data: string }>('SELECT data FROM saves WHERE user_id = ?', [userId])
        if (row !== undefined) {
          const parsed = JSON.parse(row.data) as unknown
          const inv = typeof parsed === 'object' && parsed !== null && typeof (parsed as Record<string, unknown>).inventory === 'object'
            ? ((parsed as Record<string, unknown>).inventory as Record<string, unknown>)
            : null
          if (inv !== null && Array.isArray(inv.items)) saveItems = inv.items.filter(isPlainObject)
        }
      } catch {
        saveItems = null
      }
      const burned = await burnedSoulUids(userId, withBurn.map(s => s.burnedUid as string))
      for (const s of withBurn) {
        const burnedUid = s.burnedUid as string
        if (burned.has(burnedUid)) continue
        const item = saveItems?.find(it => it.uid === burnedUid)
        if (item === undefined || typeof item.quality !== 'string') continue
        const expected = await expectedSoulGradeOf(item.quality)
        if (expected === null || !Number.isFinite(expected) || expected < 0) continue
        souls.push({ uid: s.uid, type: s.type, grade: Math.trunc(expected) })
        burnedNow.push(burnedUid)
      }
    }

    const want = gains.artifacts.length + souls.length
    if (want === 0) {
      res.json({ artifacts: [], souls: [] })
      return
    }
    if (!underHourlyCap(userId, want)) {
      res.status(429).json({ error: '签发过于频繁,稍候再试' })
      return
    }
    // 烧炼账先落,签发行后落:中途失败时「烧了没签成」(客户端退款保留原器,原器
    // 离手后烧炼账行随瘦身清掉),而不是「签了没烧成」(白拿一魂)。
    if (burnedNow.length > 0) await recordSoulBurns(userId, burnedNow)
    await recordLoot(userId, gains.artifacts, 'artifact', 'artifact')
    await recordLoot(userId, souls.map(s => s.uid), 'soul', 'soul')
    res.json({ artifacts: gains.artifacts, souls: souls.map(s => s.uid) })
  }).catch(() => {
    res.status(500).json({ error: '服务器异常' })
  })
})
