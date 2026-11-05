/**
 * 炼器编排层(1.58.3):登录走服务端裁决,未登录走本地同一份纯账层,行为逐字段一致。
 *
 * 三件事分得很清:
 *   · **掷点与改件**在服务端(POST /api/forge/op,跑 core/forgeResolve → 纯账层);
 *   · **簿记**(图鉴/技艺/成就计数)在客户端 —— 服务端跑的是临时 store,记了也会丢,
 *     索性只让它做账,回来后由这里补记(noteUpgrade / noteReforge);
 *   · **提示**在客户端,且与本地链共用同一份反馈函数(showUpgradeFeedback 等),
 *     免得「服务端裁定」与「本地裁定」两套文案走散。
 *
 * 登录玩家请求失败时**不做本地补掷**:本地掷出来的等级与词条没有台账,
 * 下次上传会被 equip_state 覆盖回去 —— 与其让玩家看到「强化成功、重登又变回去」,
 * 不如这一次直接说没成。
 */
import type { EquipmentInstance, EquipSlot, GNum } from '@/types'
import { EQUIP_SLOT_NAMES, equipmentTemplate } from '@/data/equipment'
import { formatGN, formatGap } from '@/utils/format'
import { gnZero } from '@/utils/gnum'
import { useAuthStore } from '@/stores/auth'
import { useInventoryStore } from '@/stores/inventory'
import { usePlayerStore } from '@/stores/player'
import { useResourcesStore } from '@/stores/resources'
import { useUiStore } from '@/stores/ui'
import { cloudApi, type ForgeOpResponse } from '@/services/cloud'
import { playSfx } from './audio'
import {
  equipSweepPlan,
  equipUpgradeQuote,
  noteUpgrade,
  showUpgradeFeedback,
  upgradeBatchPlan,
  upgradeEquipment,
  upgradeShort,
  upgradeShortfall,
  type EquipSweep,
  type UpgradeOutcome,
  type UpgradeRun
} from './forge'
import {
  autoReforge,
  autoReforgeBudget,
  noteReforge,
  reforgeCost,
  reforgeEquipment,
  showReforgeFeedback,
  type AutoReforgeOutcome,
  type ReforgeRun,
  type ReforgeTarget
} from './reforge'
import {
  showTransferFeedback,
  transferAffix,
  type TransferBlock,
  type TransferRequest,
  type TransferRun
} from './affixTransfer'
import type { ForgeOp } from './forgeResolve'
import {
  upgradeBatchBrokenToast,
  upgradeBatchDoneToast,
  upgradeCapToast,
  upgradeEquippedToast,
  upgradeShortToast
} from '@/ui/forgeText'

/** 登录态:炼器走服务端裁决 */
function isRemote(): boolean {
  return useAuthStore().loggedIn
}

/** 服务端拒绝 / 网络失败时的统一反馈:只报状态词,不缀礼貌话 */
function notSettled(): void {
  playSfx('warn')
  useUiStore().toast('未能结算', 'warn')
}

/** 把回传的整件覆盖到本地;**只覆盖不新增** —— 服务端没签过的件不该出现在行囊里 */
function applyItems(items: readonly EquipmentInstance[] | undefined): void {
  if (items === undefined) return
  const inventory = useInventoryStore()
  for (const it of items) inventory.replaceItem(it)
}

/**
 * 同一份炼器请求在途时复用同一个 Promise。
 * 服务端只挡 80ms 间隔,一次网络 RTT 内的第二击必然放行 —— 连点「强化 / 重铸 / 连强」
 * 会让同一次操作掷两遍:词条被第二次洗掉、器灵尘与灵石双扣。
 * 键取「操作 + 目标 + 次数」,不同的件仍可并行(服务端另有存档锁保证不互相覆盖)。
 */
let inflightForge: { key: string; p: Promise<ForgeOpResponse | null> } | null = null

async function ask(op: ForgeOp): Promise<ForgeOpResponse | null> {
  const key = JSON.stringify(op)
  if (inflightForge !== null && inflightForge.key === key) return inflightForge.p
  const p = askInner(op).finally(() => {
    if (inflightForge !== null && inflightForge.p === p) inflightForge = null
  })
  inflightForge = { key, p }
  return p
}

async function askInner(op: ForgeOp): Promise<ForgeOpResponse | null> {
  const player = usePlayerStore()
  const resources = useResourcesStore()
  try {
    return await cloudApi.forgeOp({
      op,
      exp: player.exp,
      dust: resources.dust,
      stone: resources.spiritStone
    })
  } catch {
    return null
  }
}

/** 从服务端响应还原一次强化的实账(供提示重用本地那套文案) */
function upgradeRunOf(uid: string, res: ForgeOpResponse): UpgradeRun {
  const d = res.detail?.kind === 'upgrade' ? res.detail : null
  if (d === null) {
    return { outcome: 'blocked', after: null, spent: null, block: 'cap', levelBefore: 0 }
  }
  const run: UpgradeRun = {
    outcome: d.outcome,
    after: res.items?.find(it => it.uid === uid) ?? null,
    spent: res.spend ?? null,
    levelBefore: d.levelBefore
  }
  if (d.block !== undefined) run.block = d.block
  return run
}

/**
 * 强化一次。登录走服务端;未登录走本地链。
 * quiet=true 供批量/一键使用:只做账不提示。
 */
export async function requestUpgrade(uid: string, opts: { quiet?: boolean } = {}): Promise<UpgradeOutcome> {
  if (!isRemote()) return upgradeEquipment(uid, opts)
  const res = await ask({ op: 'upgrade', uid, times: 1 })
  if (res === null) {
    if (!opts.quiet) notSettled()
    return 'blocked'
  }
  if (!res.ok || res.items === undefined || res.items.length === 0) {
    if (!opts.quiet) showUpgradeFeedback(uid, upgradeRunOf(uid, res))
    return 'blocked'
  }
  applyItems(res.items)
  const run = upgradeRunOf(uid, res)
  if (run.after !== null) noteUpgrade(run.after, run.outcome)
  if (!opts.quiet) showUpgradeFeedback(uid, run)
  return run.outcome
}

/**
 * 连续强化:一次请求掷完(服务端的循环与客户端同规 —— 失手即停),只报一次总账。
 * 返回本次成功提升的级数。
 */
export async function upgradeEquipmentBatch(uid: string): Promise<number> {
  const plan = upgradeBatchPlan(uid)
  if (plan.attempts === 0) {
    playSfx('warn')
    const next = equipUpgradeQuote(uid)
    const short = next === null ? null : upgradeShort(next)
    const gap = next === null ? { dust: 0, exp: gnZero(), stone: gnZero() } : upgradeShortfall(next)
    useUiStore().toast(
      plan.atCap
        ? upgradeCapToast()
        : upgradeShortToast(short ?? 'stone', { stone: formatGap(gap.stone), dust: gap.dust, exp: formatGap(gap.exp) }),
      'warn'
    )
    return 0
  }
  if (!isRemote()) {
    // 未登录:逐次走本地链(与在线同一条纯账层)
    let up = 0
    for (let i = 0; i < plan.attempts; i += 1) {
      if (upgradeEquipment(uid, { quiet: true }) !== 'up') break
      up += 1
    }
    return reportBatch(uid, up, plan.attempts, plan.stone, plan.dust)
  }
  const res = await ask({ op: 'upgrade', uid, times: plan.attempts })
  if (res === null) {
    notSettled()
    return 0
  }
  if (!res.ok || res.items === undefined || res.items.length === 0) {
    showUpgradeFeedback(uid, upgradeRunOf(uid, res))
    return 0
  }
  applyItems(res.items)
  const d = res.detail?.kind === 'upgrade' ? res.detail : null
  if (d === null) return 0
  // 「成功提升几级」:全成时等于掷了几次,最后一次失手则少一次
  const up = d.outcome === 'up' ? d.tries : Math.max(0, d.tries - 1)
  return reportBatch(uid, up, d.tries, plan.stone, plan.dust)
}

/** 批量强化的总账提示(本地链与服务端链共用) */
function reportBatch(uid: string, up: number, tries: number, stone: GNum, dust: number): number {
  const inventory = useInventoryStore()
  const inst = inventory.findItem(uid)
  const name = equipmentTemplate(inst?.templateId ?? '')?.name ?? '此器'
  const allUp = up > 0 && up === tries
  playSfx(allUp ? 'success' : 'warn')
  useUiStore().toast(
    allUp
      ? upgradeBatchDoneToast(up, inst?.level ?? 0, dust, formatGN(stone))
      : upgradeBatchBrokenToast(name, tries, up, inst?.level ?? 0),
    allUp ? 'success' : 'warn'
  )
  return up
}

/** GNum 的形态只在格式化那一层用;与 spend 的钱袋分开命名,免得读混 */
/**
 * 一键强化:身上已装备的按部位顺序各掷一次,遇第一件付不起即止,只报一次总账。
 * 队列由服务端按水合后的行囊现算(客户端报什么都不改顺序);未登录走本地同一条链。
 */
export async function upgradeEquippedOnce(): Promise<EquipSweep> {
  const plan = equipSweepPlan()
  const out: EquipSweep = { tried: 0, ups: 0, fails: 0, capped: plan.capped }
  if (!isRemote()) {
    const inventory = useInventoryStore()
    for (const slot of plan.queue) {
      const uid = inventory.equipped[slot]
      if (!uid) continue
      const r = upgradeEquipment(uid, { quiet: true })
      if (r === 'blocked') break
      out.tried += 1
      if (r === 'up') out.ups += 1
      else out.fails += 1
    }
    return reportSweep(out, plan.stoppedAt, plan.short, plan.gap)
  }
  const res = await ask({ op: 'sweep' })
  if (res === null) {
    notSettled()
    return out
  }
  applyItems(res.items)
  const d = res.detail?.kind === 'sweep' ? res.detail : null
  if (d !== null) {
    out.tried = d.tried
    out.ups = d.ups
    out.fails = d.fails
    out.capped = d.capped
  }
  return reportSweep(out, (d?.stoppedAt ?? null) as EquipSlot | null, d?.short ?? null, d?.gap ?? null)
}

/** 一键强化的总账提示(本地链与服务端链共用) */
function reportSweep(
  out: EquipSweep,
  stoppedAt: EquipSlot | null,
  short: 'dust' | 'exp' | 'stone' | null,
  gap: { dust: number; exp: GNum; stone: GNum } | null
): EquipSweep {
  playSfx(out.ups > 0 ? 'success' : 'warn')
  const stop =
    stoppedAt !== null && short !== null && gap !== null
      ? {
          name: EQUIP_SLOT_NAMES[stoppedAt],
          text: upgradeShortToast(short, {
            stone: formatGap(gap.stone),
            dust: gap.dust,
            exp: formatGap(gap.exp)
          })
        }
      : undefined
  useUiStore().toast(upgradeEquippedToast(out, stop), out.ups > 0 ? 'success' : 'warn')
  return out
}

/** 重铸一次;登录走服务端,未登录走本地链。quiet=true 供自动重铸用 */
export async function requestReforge(uid: string, quiet = false): Promise<boolean> {
  if (!isRemote()) return reforgeEquipment(uid, quiet)
  const res = await ask({ op: 'reforge', uid })
  if (res === null) {
    if (!quiet) notSettled()
    return false
  }
  if (res.ok) applyItems(res.items)
  const d = res.detail?.kind === 'reforge' ? res.detail : null
  const after = res.items?.[0] ?? null
  if (after !== null) noteReforge(after)
  if (!quiet) {
    const run: ReforgeRun = {
      outcome: d?.outcome ?? (res.ok ? 'done' : 'gone'),
      after,
      spent: res.spend ? { stone: res.spend.stone, dust: res.spend.dust } : null,
      countBefore: d?.countBefore ?? after?.affixes.length ?? 0,
      countAfter: d?.countAfter ?? after?.affixes.length ?? 0,
      // 缺口按本地这一炉的价算(服务端没回价,回的是「该付多少」)
      cost: useInventoryStore().findItem(uid) ? reforgeCost(useInventoryStore().findItem(uid)!) : null,
      short: d?.short
    }
    showReforgeFeedback(run)
  }
  return res.ok
}

/** 自动重铸:一次请求洗完整段预算(最多 AUTO_REFORGE_MAX_BUDGET 次) */
export async function requestAutoReforge(
  uid: string,
  targets: readonly ReforgeTarget[],
  maxRolls: number
): Promise<AutoReforgeOutcome> {
  const empty: AutoReforgeOutcome = { rolls: 0, stone: gnZero(), dust: 0, stop: 'frozen', hit: null }
  if (!isRemote()) return autoReforge(uid, targets, maxRolls)
  const res = await ask({ op: 'autoReforge', uid, targets: [...targets], maxRolls: autoReforgeBudget(maxRolls) })
  if (res === null) {
    notSettled()
    return empty
  }
  if (res.ok) applyItems(res.items)
  const auto = res.detail?.kind === 'autoReforge' ? res.detail.auto : null
  if (auto === null) return empty
  // 簿记照旧按「洗了几次」补记:服务端那侧跑的是临时 store,计数落不到玩家身上
  const inventory = useInventoryStore()
  for (let i = 0; i < auto.rolls; i += 1) {
    const inst = inventory.findItem(uid)
    if (inst) noteReforge(inst)
  }
  return auto
}

/** 词条转移(确定性,无掷点;仍走服务端,否则台账会把这次改动抹回去) */
export async function requestTransfer(req: TransferRequest): Promise<boolean> {
  if (!isRemote()) return transferAffix(req)
  const res = await ask({ op: 'transfer', req })
  if (res === null) {
    notSettled()
    return false
  }
  if (res.ok) applyItems(res.items)
  const d = res.detail?.kind === 'transfer' ? res.detail : null
  const source = res.items?.find(it => it.uid === req.sourceUid)
  const target = res.items?.find(it => it.uid === req.targetUid)
  const moved = target?.affixes.find(a => a.id === req.affixId)
  const run: TransferRun =
    res.ok && source !== undefined && target !== undefined && moved !== undefined
      ? {
          ok: true,
          source,
          target,
          moved,
          cost: res.spend
            ? { stone: res.spend.stone, dust: res.spend.dust, sealStone: null }
            : { stone: gnZero(), dust: 0, sealStone: null }
        }
      : {
          ok: false,
          block: (d?.block ?? 'noLanding') as TransferBlock | 'gone' | 'short',
          short: d?.short ?? null
        }
  showTransferFeedback(req, run)
  return res.ok
}

export type { TransferRequest } from './affixTransfer'
