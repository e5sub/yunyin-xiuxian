/**
 * 丹药增益的时长上限:封顶规则与三档文案的依据。增益在 addBuff(stores/cultivation.ts)里累加,到顶后再服只延续到上限。
 * 上限对 PILLS 挂过 buffId 的增益生效,由 data/pills 推导,新增丹药挂上 buffId 即生效;
 * 含造化丹的 bless_daoyun(由事件/奇缘给出时同样封顶)。事件祝福 / 闭关 / 重伤不在此列。
 * 判据见 core/buffCap.spec.ts 与 stores/cultivation.spec.ts。
 */
import { buffDef } from '@/data/buffs'
import { PILLS } from '@/data/pills'
import { SHICHEN_SEC } from '@/data/timeUnits'
import type { BuffInstance } from '@/types'

/** 丹药增益的时长上限:四个时辰(= 8 小时),绝对值,不随单颗时长缩放 */
export const CONSUMABLE_BUFF_CAP_SEC = 4 * SHICHEN_SEC

/** 丹药能施加的增益 id;模块装载时由 data/pills 构建一次 */
const CONSUMABLE_LOOKUP: Record<string, true> = {}
for (const p of PILLS) {
  if (p.buffId) CONSUMABLE_LOOKUP[p.buffId] = true
}

/** 是否丹药能给的增益(受封顶管) */
export function isConsumableBuff(defId: string): boolean {
  return CONSUMABLE_LOOKUP[defId] === true
}

/** 某条增益的时长上限(秒);不受上限管的返回 `undefined` */
export function buffCapSec(defId: string): number | undefined {
  const def = buffDef(defId)
  return def && isConsumableBuff(defId) ? CONSUMABLE_BUFF_CAP_SEC : undefined
}

/**
 * 此刻再服一颗会被上限怎么对待(usePill 服前调用):
 *   `full`    已到顶,这一颗白费;
 *   `partial` 越过上限,只延续到顶;
 *   `none`    足额兑现。
 * 容差 0.5 秒:剩余时间以毫秒在走。
 */
export type BuffOverflow = 'none' | 'partial' | 'full'

export function buffOverflowOf(
  buffs: readonly BuffInstance[],
  defId: string,
  now: number
): BuffOverflow {
  const def = buffDef(defId)
  const cap = buffCapSec(defId)
  if (!def || cap === undefined) return 'none'
  const instance = buffs.find(b => b.defId === defId)
  const remain = instance ? Math.max(0, (instance.endsAt - now) / 1000) : 0
  if (remain >= cap - 0.5) return 'full'
  return remain + def.durationSec > cap ? 'partial' : 'none'
}
