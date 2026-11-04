/** 洞府建筑服务:升级 */
import type { BuildingId, GNum } from '@/types'
import { buildingDef } from '@/data/buildings'
import { track } from './progress'
import { gnZero, gte, subClamp } from '@/utils/gnum'
import { formatGN, formatGap } from '@/utils/format'
import { playSfx } from './audio'
import { useResourcesStore } from '@/stores/resources'
import { useDongfuStore } from '@/stores/dongfu'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import { cloudApi, type LevelOpResponse } from '@/services/cloud'
import { applyLevelSlices, buildingBatchQuote, buildingUpgradeQuote } from './levelResolve'
import {
  buildingBatchDoneToast,
  buildingDoneToast,
  buildingMansionGateToast,
  buildingGateRealmName,
  buildingPeakToast,
  buildingRealmGate,
  buildingShortReason,
  buildingShortToast
} from '@/ui/buildingText'
import type { BuildingShortSide } from '@/ui/buildingText'

export interface BuildingUpgradePreview {
  /** 预览指向的目标级(单步即下一级;连升即 level+steps) */
  nextLevel: number
  /** 升到 nextLevel 会变的效果行 */
  lines: string[]
  /** 首建(0→1):还没有当前效果,预览=整张下一级效果 */
  built: boolean
}

/** 升级/建造预览:effectText(toLevel) 与 effectText(level) 逐行比对,留下字面变掉的行;与卡面同读 effectText */
export function buildingUpgradePreview(
  id: BuildingId,
  level: number,
  /** 有效上限(洞府档闸门 < 品类上限时,到顶的卡不再印「下一级」);缺省 def.maxLevel */
  cap?: number,
  /** 连升步数:从 level 直接 diff 到 level+steps(1 即单步) */
  steps = 1
): BuildingUpgradePreview {
  const def = buildingDef(id)!
  const toLevel = level + Math.max(1, steps)
  if (toLevel > (cap ?? def.maxLevel)) return { nextLevel: toLevel, lines: [], built: level === 0 }
  // effectText 是整段散文,切行再 diff
  const cur = level > 0 ? splitEffectLines(def.effectText(level)) : []
  const nxt = splitEffectLines(def.effectText(toLevel))
  const lines = nxt.filter((line, i) => line !== cur[i])
  return { nextLevel: toLevel, lines, built: level === 0 }
}

/** 按分号拆行,只供预览比对 */
function splitEffectLines(text: string): string[] {
  return text
    .split(/[;；]/)
    .map(line => line.trim())
    .filter(Boolean)
}

export interface BuildingUpgradeInfo {
  canUpgrade: boolean
  reason: string
  stone: GNum
  ore: number
  nextLevel: number
}

export interface BuildingShortfall {
  /** 缺哪一样;两样都够时为 null */
  side: BuildingShortSide | null
  /** 灵石尚差(足够时为 0) */
  stone: GNum
  /** 玄铁尚差(足够时为 0) */
  ore: number
  /** 卡面直接展示的精确缺口;两样都够时为空串 */
  reason: string
}

/** 建筑升级的资源缺口:卡片、单升二次校验与连升 0 级拒因共用;只缺一样只报那一样 */
export function buildingShortfall(stone: GNum, ore: number): BuildingShortfall {
  const resources = useResourcesStore()
  const stoneShort = gte(resources.spiritStone, stone) ? gnZero() : subClamp(stone, resources.spiritStone)
  const oreShort = Math.max(0, ore - resources.ore)
  const stoneMissing = stoneShort.m > 0
  const oreMissing = oreShort > 0
  const side: BuildingShortSide | null =
    stoneMissing && oreMissing ? 'both' : stoneMissing ? 'stone' : oreMissing ? 'ore' : null
  return {
    side,
    stone: stoneShort,
    ore: oreShort,
    reason: side ? buildingShortReason(side, formatGap(stoneShort), oreShort) : ''
  }
}

export function buildingUpgradeInfo(id: BuildingId): BuildingUpgradeInfo {
  const def = buildingDef(id)!
  // 门槛与价目在 core/levelResolve,与服务端裁决共用同一份;这里只把机读拒因翻成文案
  const q = buildingUpgradeQuote(id)
  let reason = ''
  if (!q.can) {
    if (q.block === 'realm') reason = buildingRealmGate(buildingGateRealmName(def.unlockRealm))
    else if (q.block === 'max') reason = buildingPeakToast()
    else if (q.block === 'gate') reason = buildingMansionGateToast()
    else reason = buildingShortfall(q.stone, q.ore).reason
  }
  return { canUpgrade: q.can, reason, stone: q.stone, ore: q.ore, nextLevel: q.nextLevel }
}

/** 建筑升级的机读拒因 → 文案(单升/连升/服务端响应共用) */
function buildingBlockText(id: BuildingId, block: string): string {
  const def = buildingDef(id)!
  if (block === 'realm') return buildingRealmGate(buildingGateRealmName(def.unlockRealm))
  if (block === 'max') return buildingPeakToast()
  if (block === 'gate') return buildingMansionGateToast()
  const q = buildingUpgradeQuote(id)
  const side = block === 'stone' || block === 'ore' || block === 'both' ? block : null
  if (side === null) return buildingShortToast()
  const shortfall = buildingShortfall(q.stone, q.ore)
  return buildingShortToast(side, formatGap(shortfall.stone), shortfall.ore)
}

/** 单升:登录走服务端裁决(POST /api/progress/op);未登录走本地同一份纯账层 */
export async function upgradeBuilding(id: BuildingId): Promise<boolean> {
  const dongfu = useDongfuStore()
  const resources = useResourcesStore()
  const ui = useUiStore()
  const def = buildingDef(id)!
  if (useAuthStore().loggedIn) {
    let res: LevelOpResponse | null = null
    try {
      res = await cloudApi.progressOp({
        op: { op: 'buildingUpgrade', id, steps: 1 },
        ore: resources.ore,
        stone: resources.spiritStone
      })
    } catch {
      res = null
    }
    if (res === null) {
      playSfx('warn')
      ui.toast('未能结算', 'warn')
      return false
    }
    if (!res.ok) {
      ui.toast(buildingBlockText(id, res.reason ?? ''), 'warn')
      return false
    }
    applyLevelSlices(res.slices)
    track('buildingUpgrades')
    ui.toast(buildingDoneToast(def.name, dongfu.levels[id] ?? 0), 'success')
    return true
  }
  const info = buildingUpgradeInfo(id)
  if (!info.canUpgrade) {
    ui.toast(info.reason, 'warn')
    return false
  }
  if (!resources.hasStone(info.stone) || !resources.hasSmall('ore', info.ore)) {
    const shortfall = buildingShortfall(info.stone, info.ore)
    const text = shortfall.side
      ? buildingShortToast(shortfall.side, formatGap(shortfall.stone), shortfall.ore)
      : buildingShortToast()
    ui.toast(text, 'warn')
    return false
  }
  resources.spendStone(info.stone)
  resources.spendSmall('ore', info.ore)
  dongfu.setLevel(id, info.nextLevel)
  track('buildingUpgrades')
  ui.toast(buildingDoneToast(def.name, info.nextLevel), 'success')
  return true
}

export interface BuildingBatchPlan {
  /** 从当前级起能连升的级数(品类满级 / 洞府辖限 / 余额三者的最短) */
  levels: number
  /** 连升总耗的灵石 */
  stone: GNum
  /** 连升总耗的玄铁 */
  ore: number
  /** 停下时是不是撞了品类满级(而非辖限/资源) */
  atMax: boolean
  /** 0 级时的拒因(境界闸 / 圆满 / 辖限 / 资源不足) */
  blocked: string | null
}

/**
 * 建筑连升计划:只算不动手,逐级累加至品类满级、洞府辖限或余额缺口即止;0 级带拒因。
 * 门槛/上限须与 buildingUpgradeInfo 同步。
 */
export function buildingBatchPlan(id: BuildingId): BuildingBatchPlan {
  const def = buildingDef(id)!
  // 连升计划在 core/levelResolve 的同一份判据上跑(逐级重算价目,与裁决逐字段一致);这里翻文案
  const q = buildingBatchQuote(id)
  if (q.levels === 0) {
    const blocked =
      q.block === 'realm'
        ? buildingRealmGate(buildingGateRealmName(def.unlockRealm))
        : q.block === 'max'
          ? buildingPeakToast()
          : q.block === 'gate'
            ? buildingMansionGateToast()
            : (() => {
                const shortfall = buildingShortfall(q.stone, q.ore)
                return shortfall.side
                  ? buildingShortToast(shortfall.side, formatGap(shortfall.stone), shortfall.ore)
                  : buildingShortToast()
              })()
    return { levels: 0, stone: gnZero(), ore: 0, atMax: q.atMax, blocked }
  }
  return { levels: q.levels, stone: q.stone, ore: q.ore, atMax: q.atMax, blocked: null }
}

/** 建筑连升:一次请求升到付不起为止;登录走服务端裁决,未登录走本地同一份纯账层 */
export async function upgradeBuildingBatch(id: BuildingId): Promise<number> {
  const dongfu = useDongfuStore()
  const resources = useResourcesStore()
  const ui = useUiStore()
  const def = buildingDef(id)!
  const plan = buildingBatchPlan(id)
  if (plan.levels === 0) {
    playSfx('warn')
    ui.toast(plan.blocked ?? buildingShortToast(), 'warn')
    return 0
  }
  if (useAuthStore().loggedIn) {
    let res: LevelOpResponse | null = null
    try {
      res = await cloudApi.progressOp({
        op: { op: 'buildingUpgrade', id, steps: 0 },
        ore: resources.ore,
        stone: resources.spiritStone
      })
    } catch {
      res = null
    }
    if (res === null) {
      playSfx('warn')
      ui.toast('未能结算', 'warn')
      return 0
    }
    if (!res.ok || res.detail?.kind !== 'building' || res.detail.levels <= 0) {
      playSfx('warn')
      ui.toast('未能结算', 'warn')
      return 0
    }
    applyLevelSlices(res.slices)
    track('buildingUpgrades', res.detail.levels)
    playSfx('success')
    ui.toast(
      buildingBatchDoneToast(
        def.name,
        res.detail.levels,
        res.detail.to,
        formatGN(res.spend?.stone ?? gnZero()),
        res.spend?.ore ?? 0
      ),
      'success'
    )
    return res.detail.levels
  }
  const from = dongfu.levels[id] ?? 0
  resources.spendStone(plan.stone)
  resources.spendSmall('ore', plan.ore)
  dongfu.setLevel(id, from + plan.levels)
  // 按实际级数计,与逐级升级同源
  track('buildingUpgrades', plan.levels)
  playSfx('success')
  ui.toast(buildingBatchDoneToast(def.name, plan.levels, from + plan.levels, formatGN(plan.stone), plan.ore), 'success')
  return plan.levels
}
