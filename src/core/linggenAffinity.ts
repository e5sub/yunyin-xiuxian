/**
 * 灵根亲和计算:纯函数,不依赖 Pinia。
 * 多根合并取"逐项最大"而非累加:累加会让五杂灵根(覆盖 5 种元素)成为唯一最优解。
 */
import type { ElementId, SpiritRoot } from '@/types'
import type { TribulationKind } from '@/data/tribulations'
import { ELEMENT_AFFINITY, NO_RELIEF, type TribulationRelief } from '@/data/linggenAffinity'

/** 从灵根画像取出元素集合 */
export function rootElements(roots: readonly SpiritRoot[] | undefined): ElementId[] {
  if (!roots || roots.length === 0) return []
  return [...new Set(roots.map(r => r.element))]
}

/** 同源加权:该元素若在灵根中,返回亲和倍率;否则 1(不惩罚,路不关) */
function affinityMult(element: ElementId | undefined, elements: readonly ElementId[], key: 'gongfaWeight' | 'fortuneWeight'): number {
  if (!element) return 1
  if (!elements.includes(element)) return 1
  return ELEMENT_AFFINITY[element][key]
}

/** 功法参悟权重倍率(同源功法更容易被参悟到) */
export function gongfaAffinity(element: ElementId | undefined, elements: readonly ElementId[]): number {
  return affinityMult(element, elements, 'gongfaWeight')
}

/** 机缘出现权重倍率(同源机缘更容易撞见) */
export function fortuneAffinity(element: ElementId | undefined, elements: readonly ElementId[]): number {
  return affinityMult(element, elements, 'fortuneWeight')
}

/** 该灵根面对此劫型时解锁的解法通道;多根逐项取最大,不叠加 */
export function tribulationRelief(elements: readonly ElementId[], kind: TribulationKind): TribulationRelief {
  let out = NO_RELIEF
  for (const el of elements) {
    const aff = ELEMENT_AFFINITY[el]
    // kind 为 null(混沌)表示通吃;否则须劫型对上
    if (aff.kind !== null && aff.kind !== kind) continue
    out = {
      shieldRestore: Math.max(out.shieldRestore, aff.relief.shieldRestore ?? 0),
      healRestore: Math.max(out.healRestore, aff.relief.healRestore ?? 0),
      frontLoadEase: Math.max(out.frontLoadEase, aff.relief.frontLoadEase ?? 0),
      burstTierBonus: Math.max(out.burstTierBonus, aff.relief.burstTierBonus ?? 0),
      reductionToResist: Math.max(out.reductionToResist, aff.relief.reductionToResist ?? 0)
    }
  }
  return out
}

/** 此通道是否真的开着(全零即"这道劫与你的灵根无关") */
export function reliefFelt(r: TribulationRelief): boolean {
  return r.shieldRestore > 0 || r.healRestore > 0 || r.frontLoadEase > 0 || r.burstTierBonus > 0 || r.reductionToResist > 0
}

/** 该灵根在五种劫型中,有解法通道的那几种 */
export function reliefKinds(elements: readonly ElementId[]): TribulationKind[] {
  const kinds = new Set<TribulationKind>()
  for (const el of elements) {
    const aff = ELEMENT_AFFINITY[el]
    if (aff.kind === null) return ['thunder', 'counterflow', 'soulrend', 'ironbody', 'heavyrush']
    kinds.add(aff.kind)
  }
  return [...kinds]
}

/** 与此劫气机相应的那几种灵根(UI 用);判据复用 tribulationRelief,与结算同口径 */
export function reliefElements(elements: readonly ElementId[], kind: TribulationKind): ElementId[] {
  return elements.filter(el => reliefFelt(tribulationRelief([el], kind)))
}

export interface TendencyLine {
  element: ElementId
  text: string
}

/** 道途倾向文案(UI 用);刻意不返回任何数字 */
export function tendencyLines(elements: readonly ElementId[]): TendencyLine[] {
  return elements.map(el => ({ element: el, text: ELEMENT_AFFINITY[el].tendency }))
}
