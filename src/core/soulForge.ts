/** 器魂凝炼:类型由装备主导词条判定,品阶由品质决定 */
import type { EquipmentInstance, StatMods } from '@/types'
import { uid } from '@/utils/id'
import { qualityDef } from '@/data/qualities'
import { equipmentTemplate } from '@/data/equipment'
import { SOUL_TYPES, soulGradeOfQuality, type SoulInstance, type SoulTypeDef } from '@/data/souls'
import { resolveEquipStats } from './equipGen'

/** 某类器魂判定键上的词条合计 */
function typeScore(mods: StatMods, def: SoulTypeDef): number {
  let sum = 0
  for (const key of def.judgeKeys) {
    const v = mods[key]
    if (typeof v === 'number' && v > 0) sum += v
  }
  return sum
}

export interface SoulPreview {
  /** 将凝出的器魂类型;null 表示无任何判定词条 */
  type: SoulTypeDef | null
  gradeRank: number
  /** 各类型的判定得分(UI 展示用) */
  scores: { def: SoulTypeDef; score: number }[]
}

/** 预览凝出的器魂,不改任何状态;类型只看词条,不看品质 */
export function previewSoul(inst: EquipmentInstance): SoulPreview {
  const resolved = resolveEquipStats(inst)
  const scores = SOUL_TYPES.map(def => ({ def, score: typeScore(resolved.mods, def) })).sort((a, b) => b.score - a.score)
  const top = scores[0]
  const quality = qualityDef(inst.quality)
  return {
    type: top && top.score > 0 ? top.def : null,
    gradeRank: soulGradeOfQuality(quality.rank).rank,
    scores
  }
}

/** 生成器魂实例,null 表示无形意;销毁原器由调用方(soulService)负责 */
export function refineSoul(inst: EquipmentInstance): SoulInstance | null {
  const preview = previewSoul(inst)
  if (!preview.type) return null
  const template = equipmentTemplate(inst.templateId)
  return {
    uid: uid(),
    type: preview.type.id,
    grade: preview.gradeRank,
    fromName: template?.name ?? '无名法器'
  }
}

export function canRefine(inst: EquipmentInstance): boolean {
  return previewSoul(inst).type !== null
}
