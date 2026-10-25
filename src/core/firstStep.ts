/**
 * 第一步:新手开局的起点。约束(与 goal.ts 同源):
 *   一 只在开局出现:历练过一次或第一条主线达成后收卡;
 *   二 不引入新状态:由已有存档推出(计数 / 修为 / 境界),无「已看过」落盘字段;
 *   三 首页「第一步」格只写入口。
 */
import { usePlayerStore } from '@/stores/player'
import { useQuestsStore } from '@/stores/quests'
import { isRetreating } from './earlyGameService'

export interface FirstStep {
  /** 路由 */
  to: string
  /** 首页「第一步」格里的入口文字 */
  label: string
}

/** 出师界:第一条主线「踏上仙途」达成 */
const BEGINNER_MAIN_IDX = 0

export function currentFirstStep(): FirstStep | null {
  const player = usePlayerStore()
  const quests = useQuestsStore()

  if (player.dead) return null
  // 出师即收卡;「筑基以上」一条为老档兜底(老存档无计数与主线下标)
  if (quests.mainIdx > BEGINNER_MAIN_IDX) return null
  if (quests.counter('explores') > 0) return null
  if (player.major > 0) return null
  // 闭关与历练互斥(startRetreat),闭关中不指路
  if (isRetreating()) return null

  // 修为圆满时指向突破:圆满后修为不再涨
  if (player.expFull) {
    return { to: '/cultivation', label: '去突破' }
  }

  return { to: '/adventure', label: '去历练' }
}
