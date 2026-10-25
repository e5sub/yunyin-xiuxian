/** 装备生成与数值解析:Template + 随机品质 + 随机词条 → Instance */
import type { AffixDef, AffixRarity, AnyStatKey, EquipmentInstance, EquipmentTemplate, EquipSlot, GNum, QualityDef, StatMods } from '@/types'
import type { RandomService } from '@/utils/random'
import { uid } from '@/utils/id'
import { gnZero, mulN, add } from '@/utils/gnum'
import { AFFIXES, AFFIX_RARITY_RANK, affixDef, affixFitBlock, affixValue } from '@/data/affixes'
import { EQUIPMENT_TEMPLATES, equipmentTemplate } from '@/data/equipment'
import { isRareQuality, PROFOUND_RANK, QUALITIES, qualityDef } from '@/data/qualities'
import {
  EQUIP_BASE_FACTOR,
  EQUIP_LEVEL_BONUS,
  EQUIP_QUALITY_FLAT_EXP,
  QUALITY_OUT_OF_BAND,
  QUALITY_TIER_SHIFT
} from '@/data/constants'
import { powerScale } from './formulas'

export interface GenOptions {
  slot?: EquipSlot
  /** 品质下限:给了(哪怕是 0)就不吃品质窗口,只给首领/秘境/际遇;普通掉落不传(dropQualityWindow.spec 钉) */
  minQualityRank?: number
  /** 气运(提高高品质权重) */
  luck?: number
}

/** 可掉落槽位(法宝是另一套池子,见 artifacts) */
const DROP_SLOTS: EquipSlot[] = [
  'weapon',
  'head',
  'body',
  'wrist',
  'belt',
  'boots',
  'necklace',
  'ring',
  'talisman'
]

/** 模板按 (tier, slot) 预索引:生成装备是热路径 */
const TEMPLATES_BY_TIER_SLOT = new Map<string, EquipmentTemplate[]>()
const TIERS_BY_SLOT = new Map<EquipSlot, number[]>()
for (const t of EQUIPMENT_TEMPLATES) {
  const key = `${t.tier}:${t.slot}`
  const arr = TEMPLATES_BY_TIER_SLOT.get(key)
  if (arr) arr.push(t)
  else TEMPLATES_BY_TIER_SLOT.set(key, [t])
}

/** 词条按 (slot, qualityRank) 预筛资格(affixFitBlock 纯静态),热路径 */
const AFFIX_POOL_BY_SLOT_RANK = new Map<string, AffixDef[]>()
{
  let maxRank = 0
  for (const q of QUALITIES) if (q.rank > maxRank) maxRank = q.rank
  for (const slot of DROP_SLOTS) {
    for (let rank = 0; rank <= maxRank; rank += 1) {
      AFFIX_POOL_BY_SLOT_RANK.set(
        `${slot}:${rank}`,
        AFFIXES.filter(a => affixFitBlock(a, slot, rank) === null)
      )
    }
  }
}

/** 品质按下限预索引(只与 rank 下限有关) */
const QUALITIES_BY_FLOOR: QualityDef[][] = []
{
  let maxRank = 0
  for (const q of QUALITIES) if (q.rank > maxRank) maxRank = q.rank
  for (let floor = 0; floor <= maxRank; floor += 1) {
    QUALITIES_BY_FLOOR.push(QUALITIES.filter(q => q.rank >= floor))
  }
}

/** 某槽位在某层级下的模板:按阶取,不累积(与「一阶一名」配套,见 data/equipment 头注) */
function templatesAtTier(tier: number, slot: EquipSlot): EquipmentTemplate[] {
  return TEMPLATES_BY_TIER_SLOT.get(`${tier}:${slot}`) ?? []
}

/** 每槽位按阶降序的阶表(懒算缓存),仅供退档兜底 */
function tiersForSlot(slot: EquipSlot): number[] {
  const cached = TIERS_BY_SLOT.get(slot)
  if (cached) return cached
  const tiers = [...new Set(EQUIPMENT_TEMPLATES.filter(t => t.slot === slot).map(t => t.tier))].sort((a, b) => b - a)
  TIERS_BY_SLOT.set(slot, tiers)
  return tiers
}

/**
 * 取某阶某槽的模板;该阶为空则退到最近的一阶(先往下,再往上)。
 * 兜底不该被走到(realmNaming.spec 钉每阶每部位都有名目),留着防 rng.weighted(空池) 抛错卡死结算。
 */
function templatesForDrop(tier: number, slot: EquipSlot) {
  const here = templatesAtTier(tier, slot)
  if (here.length > 0) return here
  const tiers = tiersForSlot(slot)
  const fallback = tiers.find(t => t < tier) ?? tiers[tiers.length - 1]
  return fallback === undefined ? [] : templatesAtTier(fallback, slot)
}

/**
 * 某层级(可选槽位)下真正进池的装备模板;独立导出,判据直接问池子。
 * 不指定槽位时逐槽位取,不把整阶混作一堆(多写一件会挤掉别的槽位)。
 */
export function equipTemplatePool(tier: number, slot?: EquipSlot) {
  if (slot !== undefined) return templatesForDrop(tier, slot)
  return DROP_SLOTS.flatMap(s => templatesForDrop(tier, s))
}

/** 品质随机:权重 = 基础权重 × 层级加成 × 气运加成 × 窗口系数 */
export function rollQuality(tier: number, rng: RandomService, opts: GenOptions = {}): QualityDef {
  const floor = opts.minQualityRank ?? 0
  const pool = QUALITIES_BY_FLOOR[floor] ?? QUALITIES
  return rng.weighted(pool, q => qualityWeightAt(q, tier, opts))
}

/** 某档品质在某层级的掉落权重;掉落与平衡审计共用,审计不得另写近似公式 */
export function qualityWeightAt(q: QualityDef, tier: number, opts: GenOptions = {}): number {
  const luck = opts.luck ?? 0
  if (q.rank === 0) return q.weight * bandFactor(q, tier, opts)
  const tierBoost = Math.pow(QUALITY_TIER_SHIFT, (tier - 1) * Math.min(q.rank, PROFOUND_RANK) * 0.35)
  const luckBoost = 1 + luck * (isRareQuality(q) ? 1.5 : 0.5)
  return q.weight * tierBoost * luckBoost * bandFactor(q, tier, opts)
}

/** 品质窗口系数:窗口(data/qualities 的 [fromTier, toTier])内 1,窗口外按离窗口的距离指数衰减(constants.QUALITY_OUT_OF_BAND) */
function bandFactor(q: QualityDef, tier: number, opts: GenOptions): number {
  if (opts.minQualityRank !== undefined) return 1
  const distance = Math.max(0, q.fromTier - tier, tier - q.toTier)
  return distance === 0 ? 1 : Math.pow(QUALITY_OUT_OF_BAND, distance)
}

export function generateEquipment(tier: number, rng: RandomService, opts: GenOptions = {}): EquipmentInstance {
  // 未指定槽位时各槽位等概率,不由表的行序决定
  const slot = opts.slot ?? DROP_SLOTS[Math.min(DROP_SLOTS.length - 1, rng.int(0, DROP_SLOTS.length - 1))]!
  const eligible = equipTemplatePool(tier, slot)
  const template = rng.weighted(eligible, () => 1)

  const quality = rollQuality(tier, rng, opts)
  const [minA, maxA] = quality.affixes
  const affixCount = rng.int(minA, maxA)

  const chosen: { id: string; roll: number }[] = []
  const candidates = AFFIX_POOL_BY_SLOT_RANK.get(`${template.slot}:${quality.rank}`)?.slice() ?? []
  let guard = 0
  while (chosen.length < affixCount && guard < 50 && candidates.length > 0) {
    guard += 1
    const picked = rng.weighted(candidates, a => a.weight)
    chosen.push({ id: picked.id, roll: rng.next() })
    // 须保序删除:rng.weighted 的命中依赖数组序
    const idx = candidates.indexOf(picked)
    if (idx >= 0) candidates.splice(idx, 1)
  }

  return {
    uid: uid(),
    templateId: template.id,
    quality: quality.id,
    tier,
    level: 0,
    affixes: chosen
  }
}

export interface ResolvedEquipStats {
  flats: { attack: GNum; defense: GNum; maxHp: GNum }
  mods: StatMods
  /** 词条展示行,已是展示序(sortAffixLines);数值按 desc 里的 {v} 切成 before / value / after,供界面右对齐加粗 */
  affixLines: {
    id: string
    name: string
    /** 整句(数值已代入) */
    desc: string
    before: string
    value: string
    after: string
    rarity: AffixRarity
    /** 随机浮动 0~1(实例上存的 roll) */
    roll: number
  }[]
}

/** 词条展示序:先稀有的(传世 → 常见),同稀有度先看掷得满的,最后按 id 稳定 */
export function sortAffixLines<T extends { id: string; roll: number }>(rolls: readonly T[]): T[] {
  return [...rolls].sort((a, b) => {
    const ra = AFFIX_RARITY_RANK[affixDef(a.id)?.rarity ?? 'common']
    const rb = AFFIX_RARITY_RANK[affixDef(b.id)?.rarity ?? 'common']
    return rb - ra || b.roll - a.roll || a.id.localeCompare(b.id)
  })
}

export function resolveEquipStats(inst: EquipmentInstance): ResolvedEquipStats {
  const template = equipmentTemplate(inst.templateId)
  const flats = { attack: gnZero(), defense: gnZero(), maxHp: gnZero() }
  const mods: StatMods = {}
  const affixLines: ResolvedEquipStats['affixLines'] = []
  if (!template) return { flats, mods, affixLines }

  const q = qualityDef(inst.quality)
  const scale = powerScale(inst.tier)
  // 品质对平铺按 EQUIP_QUALITY_FLAT_EXP 压缩,详见常量处注释
  const factor = EQUIP_BASE_FACTOR * Math.pow(q.mult, EQUIP_QUALITY_FLAT_EXP) * (1 + inst.level * EQUIP_LEVEL_BONUS)

  for (const key of ['attack', 'defense', 'maxHp'] as const) {
    const weight = template.base[key]
    if (weight) flats[key] = add(flats[key], mulN(scale, weight * factor))
  }
  if (template.fixedMods) {
    for (const k in template.fixedMods) {
      const key = k as AnyStatKey
      mods[key] = (mods[key] ?? 0) + (template.fixedMods[key] ?? 0)
    }
  }
  for (const roll of sortAffixLines(inst.affixes)) {
    const def = affixDef(roll.id)
    if (!def) continue
    const value = affixValue(def, roll.roll)
    mods[def.key] = (mods[def.key] ?? 0) + value / 100
    const [before = '', after = ''] = def.desc.split('{v}')
    affixLines.push({
      id: def.id,
      name: def.name,
      desc: def.desc.replace('{v}', String(value)),
      before,
      value: String(value),
      after,
      rarity: def.rarity,
      roll: roll.roll
    })
  }
  return { flats, mods, affixLines }
}
