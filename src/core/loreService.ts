/**
 * 所知服务:认知与技艺的增长。
 * 知识只来自照面、动手、失手、交手与藏经阁翻检;不设 unlock(),只有 encounter / note / study。
 */
import type { PillDef } from '@/types'
import { rng } from '@/utils/random'
import { LORE_MAX, materialDef, materialsNearRank, type MaterialBucket, type MaterialDef } from '@/data/materials'
import { recipeCraft, type SkillId } from '@/data/crafting'
import { pillDef, PILLS } from '@/data/pills'
import { enemyDef } from '@/data/enemies'
import { bearableRank } from './craftability'
import { ENEMY_LORE_MAX, useLoreStore } from '@/stores/lore'
import { useDongfuStore } from '@/stores/dongfu'
import { usePlayerStore } from '@/stores/player'
import { useUiStore } from '@/stores/ui'

/** 认知层 1→2 所需的照面次数 */
export const SEEN_FOR_NATURE = 4
/** 藏经阁每级每小时推进的丹方掌握度(兼管求索新方,扛整条丹方获取线) */
export const STUDY_MASTERY_PER_HOUR = 0.05
/** 翻出一张全新丹方所需的钻研量(远小于读熟一张的 0→1) */
export const NEW_RECIPE_COST = 0.25
/** 新翻到的方子的掌握度 */
export const NEW_RECIPE_START = 0.15
/** 藏经阁翻得动的上限:够得着的阶位再往上一阶 */
export const STUDY_REACH_OVER = 1

/** 敌人认知的三道门槛(以「有效交手次数」计):1 眼熟、2 知其路数、3 洞悉 */
export const ENEMY_LORE_THRESHOLDS = [0, 1, 5, 14] as const
/** 首领认知门槛加倍 */
export const ENEMY_LORE_BOSS_MULT = 2
/** 一次败场抵数次胜场 */
export const ENEMY_LORE_LOSS_WEIGHT = 3

// ============ 认知检定(纯函数) ============

/** 辨识一味未知灵材的概率 */
export function discernChance(rank: number, discernLevel: number, seen: number): number {
  const base = 0.2 + discernLevel / 260 - (rank - 1) * 0.018
  const familiarity = Math.min(0.35, seen * 0.03)
  return Math.max(0.04, Math.min(0.9, base + familiarity))
}

/** 从知其名到知其性的概率(吃专业技艺) */
export function natureChance(rank: number, discernLevel: number, craftLevel: number, seen: number): number {
  if (seen < SEEN_FOR_NATURE) return 0
  const base = 0.1 + discernLevel / 500 + craftLevel / 300 - (rank - 1) * 0.015
  const familiarity = Math.min(0.25, (seen - SEEN_FOR_NATURE) * 0.02)
  return Math.max(0.02, Math.min(0.75, base + familiarity))
}

// ============ 服务 ============

/** 该材料的专业技艺:草木看辨药,金石看锻打 */
function craftSkillOf(def: MaterialDef): SkillId {
  return def.bucket === 'herb' ? 'herbLore' : 'smithing'
}

/**
 * 与一味灵材照面,只推进到第 2 层。
 * 历练掉落、秘境层胜、事件经 harvestMaterials 计照面;洞府、弟子、镇压、坊市、任务所得不计。
 * @returns 本次是否推进了认知层
 */
export function encounterMaterial(id: string, quiet = false): boolean {
  const def = materialDef(id)
  if (!def) return false
  const lore = useLoreStore()
  lore.markSeen(id)

  const stage = lore.loreOf(id)
  if (stage >= 2) return false

  const seen = lore.seenOf(id)
  const discernLv = lore.skillLevel('discern')
  const hit =
    stage === 0
      ? rng.chance(discernChance(def.rank, discernLv, seen))
      : rng.chance(natureChance(def.rank, discernLv, lore.skillLevel(craftSkillOf(def)), seen))
  if (!hit) {
    lore.addSkillExp('discern', 0.6)
    return false
  }

  lore.advanceLore(id, stage + 1)
  lore.addSkillExp('discern', 4 + def.rank * 1.5)
  if (stage === 1) lore.addSkillExp(craftSkillOf(def), 3 + def.rank)
  if (!quiet) {
    const ui = useUiStore()
    ui.toast(stage === 0 ? `辨出灵材「${def.name}」` : `已知「${def.name}」药性`, 'rare')
  }
  return true
}

/** 采集/掉落时抽一味当前层级会撞见的灵材(数量照旧进标量库存) */
export function rollFieldMaterial(tier: number, bucket?: MaterialBucket): MaterialDef | null {
  const pool = materialsNearRank(Math.max(1, Math.ceil(tier / 2)), bucket)
  if (pool.length === 0) return null
  // 低阶更常见,高阶永远有一线机会
  return rng.weighted(pool, x => 1 / x.rank)
}

/** 采集一批材料:抽出具体是什么并推进认知(静默) */
export function harvestMaterials(tier: number, bucket: MaterialBucket, times = 1): void {
  for (let i = 0; i < Math.min(3, times); i += 1) {
    const def = rollFieldMaterial(tier, bucket)
    if (def) encounterMaterial(def.id, true)
  }
}

/** 用一味材料做过东西:唯一能推到第 3 层"已通用"的途径 */
export function noteMaterialUsed(id: string, succeeded: boolean): void {
  const def = materialDef(id)
  if (!def) return
  const lore = useLoreStore()
  lore.markSeen(id)
  if (lore.loreOf(id) !== 2) return
  const chance = succeeded ? 0.22 : 0.34
  if (!rng.chance(chance)) return
  if (lore.advanceLore(id, LORE_MAX)) {
    lore.addSkillExp(craftSkillOf(def), 6 + def.rank * 2)
    useUiStore().toast(`已通晓「${def.name}」用法`, 'rare')
  }
}

/**
 * 炼器(强化/重铸)算作"上手过"一味矿材:矿石进「通晓」的渠道。
 * 取一件与装备层级相称的矿石登记,并按次给锻造技艺经验。
 */
export function noteSmithingUsed(tier: number, succeeded: boolean): void {
  const pool = materialsNearRank(Math.max(1, Math.ceil(tier / 2)), 'ore')
  if (pool.length === 0) return
  const def = rng.pick(pool)
  const lore = useLoreStore()
  lore.addSkillExp('smithing', (succeeded ? 10 : 6) * (1 + def.rank * 0.35))
  noteMaterialUsed(def.id, succeeded)
}

/**
 * 与一头敌人交手:敌人认知的唯一来源。认知层不给属性,只供界面逐层揭示(见 ui/enemyLore.ts);随转世不灭。
 * @param win 本场是否取胜(败绩加权计入)
 * @returns 本次是否推进了认知层
 */
export function noteEnemy(enemyId: string, win: boolean): boolean {
  const def = enemyDef(enemyId)
  if (!def) return false
  const lore = useLoreStore()
  lore.markEnemySeen(enemyId, win ? 1 : ENEMY_LORE_LOSS_WEIGHT)

  const cur = lore.enemyLoreOf(enemyId)
  if (cur >= ENEMY_LORE_MAX) return false
  const mult = def.isBoss ? ENEMY_LORE_BOSS_MULT : 1
  if (lore.enemySeenOf(enemyId) < ENEMY_LORE_THRESHOLDS[cur + 1]! * mult) return false
  if (!lore.advanceEnemyLore(enemyId, cur + 1)) return false

  const ui = useUiStore()
  if (cur + 1 >= ENEMY_LORE_MAX) ui.toast(`已洞悉「${def.name}」`, 'rare')
  else if (cur + 1 === 2) ui.toast(`已知「${def.name}」路数`, 'info')
  return true
}

/**
 * 整段照面一次入账(离线整段结算用)。照面权重与 noteEnemy 同式:胜 +1、负 +ENEMY_LORE_LOSS_WEIGHT;
 * toast 最多一声(报最高档)。
 */
export function noteEnemyMany(enemyId: string, wins: number, losses: number): boolean {
  const def = enemyDef(enemyId)
  if (!def) return false
  const seen = Math.max(0, Math.floor(wins)) + Math.max(0, Math.floor(losses)) * ENEMY_LORE_LOSS_WEIGHT
  if (seen <= 0) return false
  const lore = useLoreStore()
  lore.markEnemySeen(enemyId, seen)

  const mult = def.isBoss ? ENEMY_LORE_BOSS_MULT : 1
  let lastStage = lore.enemyLoreOf(enemyId)
  const from = lastStage
  while (lastStage < ENEMY_LORE_MAX) {
    if (lore.enemySeenOf(enemyId) < ENEMY_LORE_THRESHOLDS[lastStage + 1]! * mult) break
    if (!lore.advanceEnemyLore(enemyId, lastStage + 1)) break
    lastStage += 1
  }
  if (lastStage <= from) return false

  const ui = useUiStore()
  if (lastStage >= ENEMY_LORE_MAX) ui.toast(`已洞悉「${def.name}」`, 'rare')
  else if (lastStage === 2) ui.toast(`已知「${def.name}」路数`, 'info')
  return true
}

/** 研读丹方(典籍、师承、事件都走这里) */
export function studyRecipe(id: string, amount: number): number {
  return useLoreStore().addRecipeMastery(id, amount)
}

/** 研读图纸 */
export function studyBlueprint(id: string, amount: number): number {
  return useLoreStore().addBlueprintMastery(id, amount)
}

/** 藏经阁翻检的当刻概况 */
export interface StudyEta {
  library: number
  /** 此刻正读通哪张方子(null = 无半生方子) */
  readingId: string | null
  /** 下一件事是新方,还是先把某张读通 */
  nextIsNew: boolean
  /** 距下一件事的秒数(按现值估算;「无可翻」为 0) */
  nextInSec: number
}

/**
 * 藏经阁此刻离「下一件事」还有多远。须与 studyTick 同序:先补最生的那张、都读通了才求索新方。
 * 藏经阁未建时返回 null。
 */
export function studyEta(): StudyEta | null {
  const dongfu = useDongfuStore()
  const libLv = dongfu.levels.library
  if (libLv <= 0) return null
  const lore = useLoreStore()
  const ratePerSec = (libLv * STUDY_MASTERY_PER_HOUR) / 3600
  if (!(ratePerSec > 0)) return null

  let lowest = 1
  let target: string | null = null
  for (const [id, v] of Object.entries(lore.recipeLore)) {
    if (v > 0 && v < 1 && v < lowest) {
      lowest = v
      target = id
    }
  }
  // 先抵掉 studyFrac 里的余量
  const frac = lore.studyFrac
  if (target !== null) {
    const room = 1 - lore.recipeMastery(target)
    return { library: libLv, readingId: target, nextIsNew: false, nextInSec: Math.max(0, room - frac) / ratePerSec }
  }
  const found = studiableRecipes(usePlayerStore().major, id => lore.recipeMastery(id))[0]
  if (!found) {
    // 与 studyTick 的 studyFrac 清零同一判据
    return { library: libLv, readingId: null, nextIsNew: false, nextInSec: 0 }
  }
  return { library: libLv, readingId: null, nextIsNew: true, nextInSec: Math.max(0, NEW_RECIPE_COST - frac) / ratePerSec }
}

/** 藏经阁此刻翻得到的方子,按阶位从低到高;多收够一够能到的高一阶,境界卡在半途时架上仍有书可读 */
export function studiableRecipes(major: number, masteryOf: (id: string) => number): PillDef[] {
  const ceiling = bearableRank(major) + STUDY_REACH_OVER
  const rankOf = (p: PillDef): number => recipeCraft(p)?.rank ?? Number.MAX_SAFE_INTEGER
  return PILLS.filter(p => p.recipe && masteryOf(p.id) <= 0 && p.minRealm <= major && rankOf(p) <= ceiling).sort(
    (a, b) => rankOf(a) - rankOf(b) || a.minRealm - b.minRealm
  )
}

/**
 * 藏经阁被动钻研:每次心跳先补熟手头的方子,都读通了才向外求索。在线与离线共用,只是 dtSec 不同。
 * 「翻出新方子」这一支是丹方的唯一持续来源;少了它,高阶丹全成看得见炼不出的死内容。
 */
export function studyTick(dtSec: number): void {
  const dongfu = useDongfuStore()
  const libLv = dongfu.levels.library
  if (libLv <= 0 || dtSec <= 0) return
  const lore = useLoreStore()
  lore.studyFrac += (libLv * STUDY_MASTERY_PER_HOUR * dtSec) / 3600
  if (lore.studyFrac < 0.001) return

  let target: string | null = null
  let lowest = 1
  for (const [id, v] of Object.entries(lore.recipeLore)) {
    if (v > 0 && v < 1 && v < lowest) {
      lowest = v
      target = id
    }
  }
  if (target !== null) {
    // 只吃这张方子还差的量,盈余留在 studyFrac 给下一拍;整袋倒进会被 clamp 到 1,溢出蒸发
    const room = 1 - lore.recipeMastery(target)
    const gain = Math.min(room, lore.studyFrac)
    lore.studyFrac -= gain
    const after = lore.addRecipeMastery(target, gain)
    // 读通不静默(与翻出新方、灵材通晓、敌人洞悉同族)
    if (after >= 1) {
      const def = pillDef(target)
      if (def) useUiStore().toast(`丹方已通晓「${def.name}」`, 'rare')
    }
    return
  }

  if (lore.studyFrac < NEW_RECIPE_COST) return
  const found = studiableRecipes(usePlayerStore().major, id => lore.recipeMastery(id))[0]
  if (!found) {
    lore.studyFrac = 0
    return
  }
  lore.studyFrac -= NEW_RECIPE_COST
  studyRecipe(found.id, NEW_RECIPE_START)
  useUiStore().toast(`得丹方「${found.name}」`, 'rare')
}

/** 入门修士都会的三张方子 */
const STARTER_RECIPES = ['p_jvqisan', 'p_jvqidan', 'p_huichun'] as const
/** 旧存档折算的掌握度(旧口径下"能炼"只代表够级,不给 1) */
const LEGACY_MASTERY = 0.7
/** 开局技艺底子(约合熟练度 25「入门」);从零技艺起步,首炉聚气散把握不足两成 */
const STARTER_SKILL_EXP = 200
const STARTER_SKILLS: readonly SkillId[] = ['discern', 'herbLore', 'pairing', 'condense', 'temper', 'nurture', 'flame']

/** 播种入门认知(幂等):新号得三张入门方子;旧存档把凭丹炉等级能炼的方子折算成掌握度 */
export function seedLoreIfNeeded(): void {
  const lore = useLoreStore()
  if (lore.seeded) return
  const dongfu = useDongfuStore()
  const player = usePlayerStore()

  for (const id of STARTER_RECIPES) {
    if (lore.recipeMastery(id) <= 0) lore.addRecipeMastery(id, 1)
  }
  for (const p of PILLS) {
    if (!p.recipe) continue
    const reachable = (p.alchemyLevel ?? 1) <= dongfu.alchemyLevel && p.minRealm <= player.major
    if (reachable && lore.recipeMastery(p.id) <= 0) lore.addRecipeMastery(p.id, LEGACY_MASTERY)
  }
  // 入门方子的药材必然见过,否则新号开不了第一炉
  for (const id of STARTER_RECIPES) {
    const def = pillDef(id)
    const craft = def ? recipeCraft(def) : null
    for (const mid of craft?.materials ?? []) lore.advanceLore(mid, 1)
  }
  // 只补差额:老存档已练出的技艺不重置、不白送
  for (const id of STARTER_SKILLS) {
    const lack = STARTER_SKILL_EXP - lore.expOf(id)
    if (lack > 0) lore.addSkillExp(id, lack)
  }
  lore.seeded = true
}
