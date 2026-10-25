/** 修行目标:给玩家"现在应该干什么"的轻量上下文;只复用现有状态,不引入新资源/新系统 */
import { usePlayerStore } from '@/stores/player'
import { useAdventureStore } from '@/stores/adventure'
import { useResourcesStore } from '@/stores/resources'
import { useInventoryStore } from '@/stores/inventory'
import { detectBuild } from './buildDetect'
import { breakthroughInfo } from './breakthrough'
import { REGIONS } from '@/data/regions'
import { EQUIP_SLOT_NAMES, EQUIP_SLOTS } from '@/data/equipment'
import { BREAKTHROUGH_PREP_OPTIONS } from '@/data/earlyGame'
import { pillDef } from '@/data/pills'
import { herbGradeOfMajor } from '@/data/herbGrades'
import { breakthroughGoalText } from '@/ui/cultivationText'
import { formatNum } from '@/utils/format'

export type GoalType = 'breakthrough' | 'equipment' | 'explore' | 'material' | 'build'

export interface Goal {
  type: GoalType
  text: string
  /** 进度 0~1 */
  progress?: number
  /** 附带读数:临近突破的灵气缺口 / 流派已凑核心数 */
  hint?: string
}

/** 实体装备槽,不含 artifact(法宝走 equippedArtifacts);顺序即空槽提示优先级 */
const GEAR_SLOTS = EQUIP_SLOTS

/**
 * 灵草的低位线:野外唯一被消耗的材料(丹方 4~30 一味),10 约等于两炉最廉丹方的余量,
 * 既不至于一采就闪烁,也远低于"炼不出一炉"的绝望水位。ore 目前只进不花,不作提示对象。
 */
const MATERIAL_LOW_HERB = 10

/**
 * 临近突破时的一句提示。
 *
 * 下一境的名字必须来自 breakthroughInfo(圆满层要进下一个大境界,不能把 sub+1 钳在本境)。
 * 凝神丹与静坐只加小进阶的 breakthroughRate;大关走天劫,提示若仍说「提升成功率」就是谎话。
 */
function nearBreakthroughHint(needTribulation: boolean): string {
  if (needTribulation) return '这一步是大关天劫,凝神丹与静坐不加成功率,先看劫势再决意'
  const prep = BREAKTHROUGH_PREP_OPTIONS.filter(o => o.bonusRate > 0)
    .map(o => o.label)
    .join('、')
  const pill = pillDef('p_ningshen')?.name ?? '凝神丹'
  return `这一步是小进阶,${prep}或${pill}可提升进阶成功率`
}

/**
 * 临近突破的主页提示:除成功率口径外,把「灵气够不够破」也摆上台面 ——
 * 破境要耗 qiCost = 灵气上限 × BT_QI_COST_RATIO,灵气没蓄满就冲,会在修炼页被
 * 一口「灵气未满」弹回来。这里直接报还差几成,别等玩家点破才知道。
 */
function breakthroughNearHint(needTribulation: boolean, qiShort: number): string {
  const base = nearBreakthroughHint(needTribulation)
  if (qiShort <= 0) return base
  return `${base};灵气还差 ${formatNum(qiShort)} 才够破境`
}

/** 纯函数:根据玩家状态生成当前目标 */
export function generateCurrentGoal(player: ReturnType<typeof usePlayerStore>): Goal | null {
  if (player.dead) return null

  if (!player.atMaxRealm && player.expProgress >= 0.5) {
    const near = player.expProgress >= 0.85
    const info = breakthroughInfo()
    const res = useResourcesStore()
    const qiShort = Math.max(0, info.qiCost - res.qi)
    return {
      type: 'breakthrough',
      text: breakthroughGoalText(near, info.needTribulation, info.targetLabel),
      progress: player.expProgress,
      hint: near ? breakthroughNearHint(info.needTribulation, qiShort) : undefined
    }
  }

  const build = detectBuild(player.finalStats.mods)
  if (build) {
    const style = build.style.name
    // 分母取流派真实核心词条数(2 或 3),写死 4 则满筑也到不了 100%
    const core = build.coreValues.length
    const coreTotal = Object.keys(build.style.core).length
    return {
      type: 'build',
      text: `完善「${style}」流派`,
      progress: Math.min(1, core / coreTotal),
      hint: `当前已凑出 ${core}/${coreTotal} 个核心词条,继续寻找关键装备`
    }
  }

  // 历练优先于材料/装备;材料与装备只在已通关过至少一地界后提示,免与 explore 重复
  const adventure = useAdventureStore()
  const nextRegion = REGIONS.find(r => adventure.unlocked.includes(r.id) && !adventure.cleared.includes(r.id))
  if (nextRegion) {
    return {
      type: 'explore',
      text: `深入「${nextRegion.name}」`,
      hint: '增长阅历,也寻些机缘与材料'
    }
  }
  const hasClearedAny = adventure.cleared.length > 0

  // 材料先于装备:断粮卡丹方是阻断,空槽只是战力余量。
  // 判缺按最高已通关地界的品(loot 按地界给品,见 loot.ts):world-break 后它常低于当前大境界,
  // 按当前品判缺会推荐采不出的品。不读跨品总和(旧品会掩盖断粮)。
  const resources = useResourcesStore()
  const best = hasClearedAny
    ? [...REGIONS].filter(r => adventure.cleared.includes(r.id)).sort((a, b) => b.tier - a.tier)[0]
    : undefined
  const currentHerb = resources.herbOf(herbGradeOfMajor(best ? best.minRealm : player.major))
  if (best && currentHerb < MATERIAL_LOW_HERB) {
    return {
      type: 'material',
      text: `去「${best.name}」采集灵草`,
      progress: Math.min(1, currentHerb / MATERIAL_LOW_HERB),
      hint: '丹药原料所剩无几,历练途中常有灵草可采'
    }
  }

  const inventory = useInventoryStore()
  const emptySlot = GEAR_SLOTS.find(slot => !inventory.equipped[slot])
  if (hasClearedAny && emptySlot) {
    const filled = GEAR_SLOTS.filter(slot => inventory.equipped[slot]).length
    const slotName = EQUIP_SLOT_NAMES[emptySlot]
    return {
      type: 'equipment',
      text: `寻一件${slotName}`,
      progress: filled / GEAR_SLOTS.length,
      hint: `还缺一件${slotName},历练所得的装备里常有`
    }
  }
  return null
}
