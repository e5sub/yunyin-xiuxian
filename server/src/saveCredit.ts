/**
 * 服务端裁定的赏格落档(1.79.12)。
 *
 * 「服务端复算/裁定 → 回传数值 → 客户端本地入账」的发放路(妖王击杀赏/七会赏/闲趣三则/
 * 离线托管 ev 台账)在 1.76.0 抛弃存档之后全是蒸发:客户端 addStone/addSmall 只进渲染缓存,
 * 心跳的资源补丁以云档为基线,一笔就把本地加的那点顶回去;而服务端台账(击杀赏/ev_* )
 * 在回传时已清零,连重领的机会都没有。现由本助手在服务端把赏格直接写进云档 resources,
 * 客户端本地那次入账退化为「乐观显示」(数值与云档一致,下一拍心跳对齐)。
 *
 * 与 economy.ts 的进项落档(1.79.11)同一铁律:服务端自算的进项直接落档即权威基线,
 * 不另走台账 → 上传兑现的死链。
 */
import { get, upsertByPk } from './db.js'
import { withKeyLock } from './mutex.js'
import { backupBeforeOverwrite } from './routes/save.js'
import { gnumAdd } from './gnumOps.js'
import { loadClientModule } from './clientVendor.js'

/** 层级折算尺(1.79.12):vendor 公式层,与客户端 grantEventReward 同源 */
const FORMULA_SOURCE = '../../../src/core/formulas'
const FORMULA_VENDOR = 'formulas'

interface FormulaMod {
  stoneByTier: (tier: number, amount: number) => { m: number; e: number }
  maxTierForMajor: (major: number) => number
}

let formulaMod: Promise<FormulaMod> | null = null

/** vendor 公式模块(装载失败不缓存 rejected:部署事故修好即恢复,与 routes 同规) */
export function rewardFormulas(): Promise<FormulaMod> {
  formulaMod ??= loadClientModule<FormulaMod>(FORMULA_SOURCE, FORMULA_VENDOR)
  formulaMod.catch(() => {
    formulaMod = null
  })
  return formulaMod
}

/** 按云档 player.major 折算层级;读不到档按 1 层兜底(宁可少发,不发假数) */
export async function tierOfSave(userId: number): Promise<number> {
  try {
    const row = await get<{ data: string }>('SELECT data FROM saves WHERE user_id = ?', [userId])
    if (row !== undefined) {
      const data = JSON.parse(row.data) as Record<string, unknown>
      const major =
        typeof data.player === 'object' && data.player !== null && Number.isFinite((data.player as Record<string, unknown>).major)
          ? Math.max(0, Math.trunc((data.player as Record<string, unknown>).major as number))
          : 0
      return (await rewardFormulas()).maxTierForMajor(major)
    }
  } catch {
    /* 兜底 1 层 */
  }
  return 1
}

/**
 * 把「层级级」的赏格折成最终值并落档:tier 省略时按云档境界现算。
 * 各发放路(boss/event/leisure/autoops)共用这一步,折算与入账只此一处。
 */
export async function creditEventReward(
  userId: number,
  reward: { stone?: number; herb?: number; ore?: number; wudao?: number; dust?: number; page?: number },
  tier?: number
): Promise<boolean> {
  const resolvedTier = tier ?? (await tierOfSave(userId))
  const f = await rewardFormulas()
  return creditGains(userId, {
    stone: typeof reward.stone === 'number' && reward.stone > 0 ? f.stoneByTier(resolvedTier, reward.stone) : undefined,
    herb: reward.herb,
    ore: reward.ore,
    wudao: reward.wudao,
    dust: reward.dust,
    page: reward.page
  })
}

/** 一次赏格的各分项;stone 为折算后的最终值(调用方先按层级折好) */
export interface RewardGains {
  stone?: { m: number; e: number }
  herb?: number
  ore?: number
  wudao?: number
  dust?: number
  page?: number
}

const SMALL_FIELDS = ['herb', 'ore', 'wudao', 'dust', 'page'] as const

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * 把赏格写进云档 resources(smart:各分项 >0 才动;档不存在/不可读返回 false)。
 * 与炼器/经济落档同一把 `save:<uid>` 锁;updated_at 不动(时间锚点不受影响)。
 */
export async function creditGains(userId: number, gains: RewardGains): Promise<boolean> {
  return withKeyLock(`save:${userId}`, async () => {
    const stone = gains.stone
    const hasStone = isPlainObject(stone) && typeof stone.m === 'number' && Number.isFinite(stone.m) && stone.m > 0
    const smalls = SMALL_FIELDS.filter(f => {
      const v = gains[f]
      return typeof v === 'number' && Number.isFinite(v) && v > 0
    })
    if (!hasStone && smalls.length === 0) return false
    const row = await get<{ version: number; data: string; updated_at: number; started: number }>(
      'SELECT version, data, updated_at, started FROM saves WHERE user_id = ?',
      [userId]
    )
    if (row === undefined) return false
    let data: Record<string, unknown>
    try {
      data = JSON.parse(row.data) as Record<string, unknown>
    } catch {
      return false
    }
    const res = isPlainObject(data.resources) ? data.resources : null
    if (res === null) return false
    if (hasStone && isPlainObject(stone)) {
      res.spiritStone = gnumAdd(res.spiritStone, { m: stone.m, e: stone.e })
    }
    for (const f of smalls) {
      const v = gains[f] as number
      const cur = typeof res[f] === 'number' && Number.isFinite(res[f]) ? Math.floor(res[f]) : 0
      res[f] = cur + Math.floor(v)
    }
    try {
      await backupBeforeOverwrite(userId, {
        version: row.version,
        data: JSON.stringify(data),
        updated_at: row.updated_at
      })
    } catch {
      // 留档失败不拦赏格
    }
    await upsertByPk('saves', {
      user_id: userId,
      version: row.version,
      data: JSON.stringify(data),
      started: row.started,
      updated_at: row.updated_at
    })
    return true
  })
}
