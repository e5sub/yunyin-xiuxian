/**
 * 分解返还 = 底材(按品质 DECOMPOSE_DUST)+ 强化投入的八成(尘与灵石同率)。
 * 强化投入以 item.invested 为准(每次强化按实付累加),不按公式重算:forgeDiscount 是当时装束的折扣,只有账本记得住。
 * 没有这本账的老档按标价补算(带折扣的旧档会多退一点);新账按实付记,「强化再拆」不构成套利。
 */
import type { EquipmentInstance, GNum } from '@/types'
import { DECOMPOSE_DUST, DECOMPOSE_REFUND_RATE } from '@/data/constants'
import { qualityDef } from '@/data/qualities'
import { add, gn, gnZero, mulN } from '@/utils/gnum'
import { upgradeCost } from './formulas'
import { formatPercent } from '@/utils/format'

/** 返还比例文案,跟 DECOMPOSE_REFUND_RATE 走,不手写「八成」 */
export function salvageRefundPhrase(): string {
  return `含强化 ${formatPercent(DECOMPOSE_REFUND_RATE)}`
}

export interface Salvage {
  dust: number
  stone: GNum
}

/** 一件装备累计花掉的强化成本(尘 / 灵石) */
export function enhanceInvested(item: EquipmentInstance): Salvage {
  if (item.invested) return { dust: item.invested.dust, stone: gn(item.invested.stone) }
  const rank = qualityDef(item.quality).rank
  let dust = 0
  let stone = gnZero()
  for (let level = 0; level < item.level; level += 1) {
    const cost = upgradeCost(level, item.tier, rank, 0)
    dust += cost.dust
    stone = add(stone, cost.stone)
  }
  return { dust, stone }
}

/** 分解 / 回收一件装备的返还 */
export function salvageOf(item: EquipmentInstance): Salvage {
  const base = DECOMPOSE_DUST[qualityDef(item.quality).rank] ?? 1
  const spent = enhanceInvested(item)
  return {
    dust: base + Math.floor(spent.dust * DECOMPOSE_REFUND_RATE),
    stone: mulN(spent.stone, DECOMPOSE_REFUND_RATE)
  }
}
