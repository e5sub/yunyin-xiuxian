/**
 * 战力膨胀审计:只做度量,不改数值。
 *   1. realmLeapAudit       境界跨越倍率 vs 同期内容跨度
 *   2. contentCoverageAudit 各境界对全部区域的压制程度,定位内容死亡点
 *   3. powerSourceAudit     最终战力按乘区来源归因
 *   4. celestialCarryAudit  入天界时携带的构筑深度 vs 天界敌人
 *
 * 装备与功法走真实生成/真实数据;丹药、灵脉、建筑、称号、灵兽合并为「其他来源」
 * 参数化档位(见 otherSourceMods),是估算,按量级读。
 */
import type { EquipmentInstance, FinalStats, StatMods } from '@/types'
import { toNum } from '@/utils/gnum'
import { mulberry32, RandomService } from '@/utils/random'
import { COMBAT_ATK_BASE, COMBAT_DEF_BASE, COMBAT_HP_BASE, EQUIP_QUALITY_FLAT_EXP } from '@/data/constants'
import { GONGFA } from '@/data/gongfa'
import { MORTAL_TIER_MAX, REGIONS, maxTierForMajor } from '@/data/regions'
import { CELESTIAL_WORLDS } from '@/data/endgame'
import { MAX_MAJOR } from '@/data/realms'
import { enemyGearFactor, powerScale, powerScore } from './formulas'
import { QUALITIES } from '@/data/qualities'
import { EQUIP_SLOTS } from '@/data/equipment'
import { generateEquipment, qualityWeightAt, resolveEquipStats } from './equipGen'
import { celestialDepthScale } from './gauntlet'
import { computeFinalStats, mergeMods, modDepth } from './statsCalc'

export interface GearProfile {
  id: string
  name: string
  /** 装备品质 rank 随大境界的斜率 */
  qualityPerMajor: number
  /**
   * 装备品质分位:这一层级真实掉落池里玩家所在的分位。
   * 按「品质 rank = 境界 × 斜率」取会假设真仙满身神品,算出无人拥有的战力。
   */
  qualityQuantile: number
  /** 强化等级随大境界的斜率 */
  levelPerMajor: number
  /** 「其他来源」百分比随大境界的斜率(丹药+灵脉+建筑+称号+灵兽合计) */
  otherPctPerMajor: number
}

export const GEAR_PROFILES: GearProfile[] = [
  { id: 'casual', name: '随缘', qualityPerMajor: 0, levelPerMajor: 0.6, otherPctPerMajor: 0.05, qualityQuantile: 0.25 },
  { id: 'typical', name: '常规', qualityPerMajor: 0, levelPerMajor: 1.0, otherPctPerMajor: 0.09, qualityQuantile: 0.5 },
  { id: 'optimized', name: '极限', qualityPerMajor: 0, levelPerMajor: 1.5, otherPctPerMajor: 0.15, qualityQuantile: 0.85 }
]

/** 某层级掉落池按权重排开,第 p 分位落在哪一档品质;与 rollQuality 共用 qualityWeightAt */
export function qualityQuantileAt(tier: number, p: number): number {
  const weights = QUALITIES.map(q => qualityWeightAt(q, tier))
  const total = weights.reduce((s, w) => s + w, 0)
  if (total <= 0) return 0
  let acc = 0
  for (let i = 0; i < weights.length; i += 1) {
    acc += weights[i]!
    if (acc / total >= p) return i
  }
  return weights.length - 1
}

export function gearProfile(id: string): GearProfile {
  return GEAR_PROFILES.find(p => p.id === id) ?? GEAR_PROFILES[1]!
}

/** 该大境界可进入的全部区域层级 */
export function reachableTiers(major: number): number[] {
  return REGIONS.filter(r => r.minRealm <= major)
    .map(r => r.tier)
    .sort((a, b) => a - b)
}

/** 「其他来源」(丹药/灵脉/建筑/称号/灵兽)按大境界线性合并的战斗百分比档位;只看占比,不求精确 */
export function otherSourceMods(major: number, profile: GearProfile): StatMods {
  const pct = major * profile.otherPctPerMajor
  return { attackPct: pct, defensePct: pct * 0.8, maxHpPct: pct * 0.9 }
}

/** 该境界可修习的最高阶主修 + 辅修功法词条 */
export function gongfaModsAt(major: number): StatMods {
  const pick = (type: 'main' | 'sub'): StatMods => {
    const usable = GONGFA.filter(g => g.type === type && g.minRealm <= major)
    if (usable.length === 0) return {}
    const best = usable.reduce((a, b) => (b.minRealm >= a.minRealm ? b : a))
    const out: StatMods = { ...best.baseMods }
    for (const k in best.perLevelMods) {
      const key = k as keyof StatMods
      out[key] = (out[key] ?? 0) + (best.perLevelMods[key] ?? 0) * best.maxLevel
    }
    return out
  }
  return mergeMods([pick('main'), pick('sub')])
}

export interface ModeledPlayer {
  major: number
  sub: number
  stats: FinalStats
  /** 各来源的独立快照,供归因用 */
  parts: {
    equipFlats: { attack: number; defense: number; maxHp: number }
    equipMods: StatMods
    gongfaMods: StatMods
    otherMods: StatMods
  }
}

/** 构建某境界的典型玩家;固定种子保证可复现 */
export function modelPlayer(major: number, sub: number, profile: GearProfile, seed = 20260904): ModeledPlayer {
  const tier = maxTierForMajor(major)
  const qualityRank = qualityQuantileAt(tier, profile.qualityQuantile)
  const level = Math.max(0, Math.min(10, Math.round(major * profile.levelPerMajor)))
  const rng = new RandomService(mulberry32(seed + major * 131 + sub * 17))

  const flats = { attack: 0, defense: 0, maxHp: 0 }
  const equipModList: StatMods[] = []
  for (const slot of EQUIP_SLOTS) {
    const inst: EquipmentInstance = { ...generateEquipment(tier, rng, { slot, minQualityRank: qualityRank }), level }
    const resolved = resolveEquipStats(inst)
    flats.attack += toNum(resolved.flats.attack)
    flats.defense += toNum(resolved.flats.defense)
    flats.maxHp += toNum(resolved.flats.maxHp)
    equipModList.push(resolved.mods)
  }

  const equipMods = mergeMods(equipModList)
  const gongfaMods = gongfaModsAt(major)
  const otherMods = otherSourceMods(major, profile)
  const stats = computeFinalStats({
    major,
    sub,
    linggenMult: 1.6,
    modSources: [equipMods, gongfaMods, otherMods],
    equipFlats: { attack: { m: flats.attack, e: 0 }, defense: { m: flats.defense, e: 0 }, maxHp: { m: flats.maxHp, e: 0 } },
    daoFruit: 0,
    qiRich: true
  })

  return { major, sub, stats, parts: { equipFlats: flats, equipMods, gongfaMods, otherMods } }
}

/** 某层级敌人的战力评分(均衡模板口径,与 makeEnemySnap 同公式) */
export function enemyPowerAt(tier: number, danger = 1): number {
  const scale = powerScale(tier)
  const gear = enemyGearFactor(tier) * danger
  return toNum(
    powerScore(
      { m: toNum(scale) * COMBAT_ATK_BASE * gear, e: 0 },
      { m: toNum(scale) * COMBAT_DEF_BASE * gear, e: 0 },
      { m: toNum(scale) * COMBAT_HP_BASE * gear, e: 0 }
    )
  )
}

export interface RealmLeapRow {
  fromMajor: number
  toMajor: number
  /** 旧境界圆满时的战力 */
  beforePower: number
  /** 新境界一层时的战力(含装备换代) */
  afterPower: number
  /** 玩家跨越倍率 */
  leapMult: number
  /** 同期内容跨度倍率(旧境界最高区域 → 新境界最高区域) */
  contentMult: number
  /** 脱节度:玩家跨越 ÷ 内容跨度,>1 表示这一跃跑在内容前面 */
  detach: number
}

/** @param seed 装备掷点种子;默认值沿用,便于与新读数对照;多样本均值见 inflationAudit.spec */
export function realmLeapAudit(profile: GearProfile, seed = 20260904): RealmLeapRow[] {
  const rows: RealmLeapRow[] = []
  for (let m = 0; m < MAX_MAJOR; m += 1) {
    const before = toNum(modelPlayer(m, 9, profile, seed).stats.power)
    const after = toNum(modelPlayer(m + 1, 0, profile, seed).stats.power)
    const contentBefore = enemyPowerAt(maxTierForMajor(m))
    const contentAfter = enemyPowerAt(maxTierForMajor(m + 1))
    const leapMult = before > 0 ? after / before : 0
    const contentMult = contentBefore > 0 ? contentAfter / contentBefore : 1
    rows.push({
      fromMajor: m,
      toMajor: m + 1,
      beforePower: before,
      afterPower: after,
      leapMult,
      contentMult,
      detach: contentMult > 0 ? leapMult / contentMult : 0
    })
  }
  return rows
}

export interface CoverageRow {
  major: number
  /** 可进入区域数 */
  reachable: number
  /** 其中被压制(战力比 ≥ CRUSH_RATIO)的区域数 */
  crushed: number
  /** 压制比例 */
  crushRatio: number
  /** 对最高可进入区域的战力比 */
  topPowerRatio: number
}

/**
 * 压制判据:战力比 ≥ 此值即内容失去威胁;3.0 对应裸胜率上限 0.95 并留余量。
 * 不用胜率:winChanceFromRatio 钳在 0.95,「胜率≥95%」会恒真。
 */
export const CRUSH_RATIO = 3.0

export function contentCoverageAudit(profile: GearProfile, seed = 20260904): CoverageRow[] {
  const rows: CoverageRow[] = []
  for (let m = 0; m <= MAX_MAJOR; m += 1) {
    // 境界圆满口径
    const power = toNum(modelPlayer(m, 9, profile, seed).stats.power)
    const tiers = reachableTiers(m)
    let crushed = 0
    let topPowerRatio = 0
    const maxTier = tiers.length > 0 ? Math.max(...tiers) : 0
    for (const tier of tiers) {
      const ratio = power / enemyPowerAt(tier)
      if (ratio >= CRUSH_RATIO) crushed += 1
      if (tier === maxTier) topPowerRatio = ratio
    }
    rows.push({
      major: m,
      reachable: tiers.length,
      crushed,
      crushRatio: tiers.length > 0 ? crushed / tiers.length : 0,
      topPowerRatio
    })
  }
  return rows
}

/**
 * 内容死亡点:此后再未回到有威胁状态的最早境界;未出现返回 -1。
 * 不取「首次全压制」:早期区域少、tier 与境界错配,偶发 100% 压制是采样噪声。
 */
export function contentDeathMajor(rows: CoverageRow[]): number {
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]!
    if (row.reachable <= 0 || row.crushRatio < 1) continue
    if (rows.slice(i).every(r => r.reachable <= 0 || r.crushRatio >= 1)) return row.major
  }
  return -1
}

export interface SourceRow {
  id: string
  name: string
  /** 剥离该来源后的战力跌幅,归一化为占比 */
  share: number
}

/** 战力按乘区来源归因:逐个置零取跌幅再归一化;乘区有交叉项,只是近似 */
export function powerSourceAudit(major: number, profile: GearProfile, seed = 20260904): SourceRow[] {
  const full = modelPlayer(major, 9, profile, seed)
  const fullPower = toNum(full.stats.power)

  const withParts = (opts: { equipFlat?: boolean; equipMod?: boolean; gongfa?: boolean; other?: boolean; realm?: boolean }): number => {
    const flats = opts.equipFlat === false ? { attack: 0, defense: 0, maxHp: 0 } : full.parts.equipFlats
    const sources: StatMods[] = []
    if (opts.equipMod !== false) sources.push(full.parts.equipMods)
    if (opts.gongfa !== false) sources.push(full.parts.gongfaMods)
    if (opts.other !== false) sources.push(full.parts.otherMods)
    // 境界基础以炼气一层为地板
    const stats = computeFinalStats({
      major: opts.realm === false ? 0 : major,
      sub: opts.realm === false ? 0 : 9,
      linggenMult: 1.6,
      modSources: sources,
      equipFlats: { attack: { m: flats.attack, e: 0 }, defense: { m: flats.defense, e: 0 }, maxHp: { m: flats.maxHp, e: 0 } },
      daoFruit: 0,
      qiRich: true
    })
    return toNum(stats.power)
  }

  const drops = [
    { id: 'realm', name: '境界基础', drop: Math.max(0, fullPower - withParts({ realm: false })) },
    { id: 'equipFlat', name: '装备平铺', drop: Math.max(0, fullPower - withParts({ equipFlat: false })) },
    { id: 'equipMod', name: '装备词条', drop: Math.max(0, fullPower - withParts({ equipMod: false })) },
    { id: 'gongfa', name: '功法', drop: Math.max(0, fullPower - withParts({ gongfa: false })) },
    { id: 'other', name: '丹药灵脉等', drop: Math.max(0, fullPower - withParts({ other: false })) }
  ]
  const total = drops.reduce((s, d) => s + d.drop, 0)
  return drops.map(d => ({ id: d.id, name: d.name, share: total > 0 ? d.drop / total : 0 }))
}

/** 词条深度:所有正向构筑词条的数值总和(实现在 statsCalc,与生产同源) */
export { modDepth }

export interface CelestialCarryRow {
  major: number
  /** 玩家携带的构筑深度 */
  playerDepth: number
  /** 天界敌人的原始构筑深度 */
  foeDepth: number
  /** 对称前的不对称倍数 */
  asymmetry: number
  /** 守关者加厚系数 */
  depthScale: number
  /** 对称后实际生效的不对称倍数 */
  effectiveAsymmetry: number
}

/** 天界基础三维由 worldFoeSnap 等比抵消,词条由 celestialDepthScale 抵消;量化对称前后的差距 */
export function celestialCarryAudit(profile: GearProfile): CelestialCarryRow[] {
  const foeDepths: number[] = []
  for (const world of CELESTIAL_WORLDS) {
    for (const foe of world.foes) foeDepths.push(modDepth(foe.mods ?? {}))
    foeDepths.push(modDepth(world.guardian.mods ?? {}))
  }
  const foeDepth = foeDepths.length > 0 ? foeDepths.reduce((a, b) => a + b, 0) / foeDepths.length : 0

  const rows: CelestialCarryRow[] = []
  for (let m = 5; m <= MAX_MAJOR; m += 1) {
    const mods = modelPlayer(m, 9, profile).stats.mods
    const playerDepth = modDepth(mods)
    const scale = celestialDepthScale(mods)
    rows.push({
      major: m,
      playerDepth,
      foeDepth,
      asymmetry: foeDepth > 0 ? playerDepth / foeDepth : Infinity,
      depthScale: scale,
      effectiveAsymmetry: foeDepth > 0 ? playerDepth / (foeDepth * scale) : Infinity
    })
  }
  return rows
}

export interface GearAsymmetry {
  /** 玩家装备乘区从最低到最高的增长倍数 */
  playerGearGrowth: number
  /** 敌人装备补偿系数的增长倍数 */
  enemyGearGrowth: number
  /** 两者之比 */
  ratio: number
}

/**
 * 玩家与敌人「装备乘区」的增长速度对比(玩家:品质倍率 × 强化加成;敌人:enemyGearFactor)。
 * 只在人间界层级(tier 1→20)上对账:仙界以上走 LATE_COMBAT_GROWTH 平坦曲线,由
 * contentCoverageAudit 守;按全程跨度算会把 20 层之上的敌人补偿误读成乘区失衡。
 */
export function gearAsymmetry(): GearAsymmetry {
  const low = QUALITIES[qualityQuantileAt(1, 0.5)]!
  const high = QUALITIES[qualityQuantileAt(MORTAL_TIER_MAX, 0.5)]!
  const playerLow = Math.pow(low.mult, EQUIP_QUALITY_FLAT_EXP) * (1 + 0 * 0.12)
  const playerHigh = Math.pow(high.mult, EQUIP_QUALITY_FLAT_EXP) * (1 + 10 * 0.12)
  const enemyLow = enemyGearFactor(1)
  const enemyHigh = enemyGearFactor(MORTAL_TIER_MAX)
  const playerGearGrowth = playerHigh / playerLow
  const enemyGearGrowth = enemyHigh / enemyLow
  return { playerGearGrowth, enemyGearGrowth, ratio: playerGearGrowth / enemyGearGrowth }
}

