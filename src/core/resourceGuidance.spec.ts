/** 道源/道果认知服务:S1 生命周期标签 / S2 资源说明 / S3 道源→道果链路 / S4/S5 首次教学 / S6 认知埋点 */
import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  daoSourceDialog,
  daoFruitDialog,
  fruitMarginalInfo,
  fruitCountLabel,
  fruitSoftCapText,
  shouldShowEndgameTutorial,
  markEndgameTutorialSeen,
  shouldShowFruitTutorial,
  markFruitTutorialSeen,
  fruitTutorialClosable,
  dismissFruitTutorial,
  FRUIT_TUTORIAL_CLOSE_GUARD_MS,
  cognitionStats,
  markResourceDialogSeen,
  DAO_SOURCE_ROLE,
  DAO_FRUIT_ROLE
} from './resourceGuidance'
import { usePlayerStore } from '@/stores/player'
import { useEndgameStore } from '@/stores/endgame'
import { condenseDaoFruit } from './endgameService'
import { effectiveDaoFruit } from './statsCalc'
import { DAO_SOURCE_PER_FRUIT } from '@/data/endgame'
import { DAO_FRUIT_CULT_BONUS } from '@/data/constants'

/** 模拟刷新:endgame 按持久化口径(JSON)读回新 pinia,再走启动清洗 */
function reloadEndgame(): void {
  const saved = JSON.parse(JSON.stringify(useEndgameStore().$state))
  setActivePinia(createPinia())
  useEndgameStore().$patch(saved)
  useEndgameStore().sanitize()
}

describe('S1 生命周期语义', () => {
  it('道源=此世消耗,道果=永久积累', () => {
    expect(DAO_SOURCE_ROLE).toBe('此世消耗')
    expect(DAO_FRUIT_ROLE).toBe('永久积累')
  })

  it('说明弹窗内容完整', () => {
    const ds = daoSourceDialog()
    expect(ds.name).toBe('道源')
    expect(ds.usages.length).toBeGreaterThan(0)
    expect(ds.gains.length).toBeGreaterThan(0)
    expect(ds.lifecycle).toContain('本世')
    const df = daoFruitDialog()
    expect(df.name).toBe('道果')
    expect(df.lifecycle).toContain('跨世保留')
    expect(df.lifecycle).toContain('道躯')
  })
})

describe('S3 道果边际收益', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    usePlayerStore().$patch({ reincarnation: { count: 0, daoFruit: 10, talents: [] } })
  })

  it('凝聚一枚后有效收益增长,且边际递减', () => {
    const info = fruitMarginalInfo()
    expect(info.total).toBe(10)
    expect(info.nextEffective).toBeGreaterThan(info.effective)
    // 软上限:有效道果 = 道果^0.9;10→11 增量 ≈ 8.96%
    expect(info.effective).toBeCloseTo(effectiveDaoFruit(10), 9)
    expect(fruitCountLabel(info.effective)).toBe('7.9 枚')
    expect(fruitCountLabel(info.effective)).not.toBe('8 枚')
    expect(Number(info.deltaPct)).toBeGreaterThan(8)
    expect(Number(info.deltaPct)).toBeLessThan(10)
  })

  it('软上限白话文案:如实报出下一枚的边际收益(不虚报「微乎其微」)', () => {
    expect(fruitSoftCapText(0)).toContain('尚未')
    for (const total of [5, 15, 20, 50, 200]) {
      const t = fruitSoftCapText(total)
      const eff = effectiveDaoFruit(total)
      const next = effectiveDaoFruit(total + 1)
      const marginalEff = next - eff
      const effPct = (marginalEff / eff) * 100
      const cultPct = marginalEff * DAO_FRUIT_CULT_BONUS * 100
      // 文案里的两个百分比 = 引擎现算的真实边际
      expect(t, `total=${total}`).toContain(`+${effPct.toFixed(1)}%`)
      expect(t, `total=${total}`).toContain(`+${cultPct.toFixed(1)}%`)
      // 引用当前道果数,不硬编码「二十」
      expect(t, `total=${total}`).toContain(`道果已 ${total} 枚`)
      expect(t, `total=${total}`).not.toContain('微乎其微')
      expect(Number(effPct.toFixed(1))).toBeGreaterThan(0)
    }
  })
})

describe('S4/S5 首次教学', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('真仙以下不触发终局教学', () => {
    expect(shouldShowEndgameTutorial()).toBe(false)
  })

  it('登真仙后首次触发教学,标记后不再弹', () => {
    const player = usePlayerStore()
    player.$patch({ major: 9 } as never)
    expect(shouldShowEndgameTutorial()).toBe(true)
    markEndgameTutorialSeen()
    expect(shouldShowEndgameTutorial()).toBe(false)
  })

  it('首次凝道果教学标记', () => {
    expect(shouldShowFruitTutorial()).toBe(true)
    markFruitTutorialSeen()
    expect(shouldShowFruitTutorial()).toBe(false)
  })

  /** 故障注入:condenseDaoFruit 恢复置 daoFruitTutorialSeen,本用例红 */
  it('凝成道果不置已见:说明未关前刷新,下次凝果仍弹', () => {
    useEndgameStore().addDaoSource(DAO_SOURCE_PER_FRUIT)
    expect(shouldShowFruitTutorial()).toBe(true)
    expect(condenseDaoFruit()).toBe(true)
    expect(useEndgameStore().daoFruitTutorialSeen, '凝成即置:说明显示中刷新即永久丢失').toBe(false)
    reloadEndgame()
    expect(shouldShowFruitTutorial(), '刷新后仍应弹').toBe(true)
  })

  /** 故障注入:dismissFruitTutorial 先置已见再判保护期,本用例红 */
  it('保护期内的关闭请求不作数,也不置已见', () => {
    const t0 = 5000
    for (const dt of [0, 120, FRUIT_TUTORIAL_CLOSE_GUARD_MS - 1]) {
      expect(dismissFruitTutorial(t0, t0 + dt), `+${dt}ms 关了窗`).toBe(false)
      expect(useEndgameStore().daoFruitTutorialSeen, `+${dt}ms 置了已见`).toBe(false)
    }
  })

  it('过了保护期关掉才算已见:刷新后不再弹', () => {
    const t0 = 5000
    expect(dismissFruitTutorial(t0, t0 + FRUIT_TUTORIAL_CLOSE_GUARD_MS)).toBe(true)
    expect(useEndgameStore().daoFruitTutorialSeen).toBe(true)
    reloadEndgame()
    expect(shouldShowFruitTutorial()).toBe(false)
  })

  /** 故障注入:保护期改成 0,本用例红 */
  it('道果说明打开后的连点不关窗,过了保护期照常关', () => {
    const t0 = 5000
    expect(fruitTutorialClosable(t0, t0), '双击的第二下').toBe(false)
    expect(fruitTutorialClosable(t0, t0 + 120), '120ms 后再点').toBe(false)
    expect(fruitTutorialClosable(t0, t0 + FRUIT_TUTORIAL_CLOSE_GUARD_MS - 1)).toBe(false)
    expect(fruitTutorialClosable(t0, t0 + FRUIT_TUTORIAL_CLOSE_GUARD_MS)).toBe(true)
    expect(fruitTutorialClosable(t0, t0 + 500), '半秒后照常关').toBe(true)
  })
})

describe('S6 认知埋点', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('埋点统计:道源/道果/教学标记/说明弹窗', () => {
    const endgame = useEndgameStore()
    endgame.addDaoSource(DAO_SOURCE_PER_FRUIT)
    condenseDaoFruit()
    markResourceDialogSeen()
    const stats = cognitionStats()
    expect(stats.daoSource).toBe(0)
    expect(stats.daoFruit).toBe(1)
    expect(stats.fruitSeen, 'fruitSeen 只记关掉过道果说明,凝果不算').toBe(false)
    expect(stats.dialogSeen).toBe(true)
    expect(stats.tutorialSeen).toBe(false)
    dismissFruitTutorial(0, FRUIT_TUTORIAL_CLOSE_GUARD_MS)
    expect(cognitionStats().fruitSeen).toBe(true)
  })
})
