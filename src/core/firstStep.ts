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
  /** 按钮文字 */
  label: string
  /** 一句话:现在该做什么 */
  text: string
  /** 一句话:为什么(不给理由的指路就是命令) */
  hint: string
}

/** 出师的界:第一条主线「踏上仙途(突破至炼气三层)」达成 */
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

  /**
   * 修为圆满时唯一该做的是回修炼页突破。这时还把人往历练赶是错的:
   * 新玩家九成会以为「还得多打几只」,而修为正卡在圆满线上不再涨。
   */
  if (player.expFull) {
    return {
      to: '/cultivation',
      label: '去突破',
      text: '第一步 · 修为已圆满,回修炼页突破',
      hint: '修为满了就不再涨,突破是眼下唯一能往前走的一步'
    }
  }

  return {
    to: '/adventure',
    label: '去历练',
    text: '第一步 · 去历练走一趟',
    hint: '历练有敌人、装备、灵草与灵石;修为自己会涨,圆满了回修炼页突破'
  }
}
