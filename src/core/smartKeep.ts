/**
 * 智能收纳:行囊的自动去留裁决。除品质外,识别流派核心件与组合技关键件。
 * 永不自动处置:练过的件(强化 / 重铸 / 转入词条 / 封存)、成套共鸣件、词条近满件。
 */
import type { EquipmentInstance } from '@/types'
import { qualityDef } from '@/data/qualities'
import { SMART_KEEP_PERFECT_ROLL } from '@/data/constants'
import { equipmentTemplate } from '@/data/equipment'
import { BUILD_STYLES, detectBuild } from './buildDetect'
import { matchComboArt } from '@/data/comboArts'
import { equipSetDef } from './equipSet'
import { resolveEquipStats } from './equipGen'
import { usePlayerStore } from '@/stores/player'
import { useSettingsStore } from '@/stores/settings'

export interface SmartKeepConfig {
  enabled: boolean
  /** 达到此品质 rank 保留 */
  minQuality: number
  /** 阶级自留线:与品质线是「且」,双线皆满才留;0 = 不启用(视为通过) */
  keepMinTier: number
  /** 保留含当前主流派核心词条的装备 */
  keepCoreAffix: boolean
  /** 保留可能促成组合技的副体系件 */
  keepComboPiece: boolean
  /** 保留词条条条近满的件 */
  keepPerfectRolls: boolean
  /** 保留成套共鸣件 */
  keepSetPiece: boolean
}

export interface KeepVerdict {
  keep: boolean
  reason: string
}

/**
 * 自动回收裁决:装备进包前的第一道闸。智能收纳未开则一律不回收;开启后由 keepVerdict 判,未命中保留规则即化尘。
 * 上锁者豁免。「一键分解」勾选的品质档只作用于行囊内已存之件的手动批量分解,不参与落包裁决。
 */
export function shouldAutoRecycle(item: EquipmentInstance): boolean {
  return autoRecycleReason(item) !== null
}

/** 自动回收时告诉玩家的那一句;只出自智能收纳自身规则,不含手动勾选档 */
export function autoRecycleReason(item: EquipmentInstance): string | null {
  if (item.locked) return null
  const settings = useSettingsStore()
  if (!settings.smartKeep.enabled) return null
  const verdict = keepVerdict(item)
  return verdict.keep ? null : verdict.reason
}

/** 有无玩家投入(强化 / 重铸 / 封存词条 / 转入词条);有则不参与一切自动去留。转入词条须算:一条可达上万器灵尘 */
export function hasInvestment(item: EquipmentInstance): boolean {
  return (
    item.level > 0 ||
    (item.reforgeCount ?? 0) > 0 ||
    (item.sealedAffixIds ?? []).length > 0 ||
    (item.transferCount ?? 0) > 0
  )
}

/** 词条是否条条在满值线以上;0 词条不算 */
export function perfectRolls(item: EquipmentInstance): boolean {
  return item.affixes.length > 0 && item.affixes.every(a => a.roll >= SMART_KEEP_PERFECT_ROLL)
}

/** 判定一件装备是否值得收纳 */
export function keepVerdict(item: EquipmentInstance): KeepVerdict {
  const cfg = useSettingsStore().smartKeep
  const q = qualityDef(item.quality)
  // 先于品质判:练过的件不归自动裁决
  if (hasInvestment(item)) return { keep: true, reason: '已淬养' }
  const tierMet = cfg.keepMinTier <= 0 || item.tier >= cfg.keepMinTier
  const qMet = q.rank >= cfg.minQuality
  if (qMet && tierMet) {
    const both = cfg.keepMinTier > 0 && item.tier >= cfg.keepMinTier
    return { keep: true, reason: both ? `${q.name}·${item.tier}阶,双线皆满` : `${q.name}当藏` }
  }

  // 不看流派,须排在「未成流派」之前:新档也留成套件与满值件
  const setId = equipmentTemplate(item.templateId)?.set
  if (cfg.keepSetPiece && setId) return { keep: true, reason: `「${equipSetDef(setId)?.name ?? '成套'}」套件` }
  if (cfg.keepPerfectRolls && perfectRolls(item)) return { keep: true, reason: '词条近满' }

  const build = detectBuild(usePlayerStore().finalStats.mods)
  if (!build) return { keep: false, reason: '未成流派' }
  const mods = resolveEquipStats(item).mods

  if (cfg.keepCoreAffix) {
    for (const key of Object.keys(build.style.core)) {
      if ((mods[key as keyof typeof mods] ?? 0) > 0) {
        return { keep: true, reason: `含${build.style.name}核心词条` }
      }
    }
  }
  if (cfg.keepComboPiece) {
    for (const style of BUILD_STYLES) {
      if (style.id === build.style.id) continue
      const art = matchComboArt(build.style.id, style.id)
      if (!art) continue
      for (const key of Object.keys(style.core)) {
        if ((mods[key as keyof typeof mods] ?? 0) > 0) {
          return { keep: true, reason: `「${art.name}」组合技部件` }
        }
      }
    }
  }
  return { keep: false, reason: '与道无缘' }
}

/** 行囊满时挤位顺序:品质最低 → 层级最低 → 词条最弱(练过的件不进候选) */
export function compareEvictable(a: EquipmentInstance, b: EquipmentInstance): number {
  const qa = qualityDef(a.quality).rank
  const qb = qualityDef(b.quality).rank
  if (qa !== qb) return qa - qb
  if (a.tier !== b.tier) return a.tier - b.tier
  return rollSum(a) - rollSum(b)
}

function rollSum(item: EquipmentInstance): number {
  return item.affixes.reduce((s, x) => s + x.roll, 0)
}

/** 将被清理的一件:未上锁且 keepVerdict 判不保 */
export interface SweepTarget {
  item: EquipmentInstance
  /** 同源:keepVerdict 的理由 */
  reason: string
}

/** 清理预告:与挤位同一把尺,弱者在前。预览与执行用同一份名单,调用方不得另写筛选 */
export function sweepTargets(items: readonly EquipmentInstance[]): SweepTarget[] {
  const targets: SweepTarget[] = []
  for (const it of items) {
    if (it.locked) continue
    const verdict = keepVerdict(it)
    if (!verdict.keep) targets.push({ item: it, reason: verdict.reason })
  }
  return targets.sort((a, b) => compareEvictable(a.item, b.item))
}

export function smartKeepEnabled(): boolean {
  return useSettingsStore().smartKeep.enabled
}
