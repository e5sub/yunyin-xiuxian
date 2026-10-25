/* eslint-disable no-console -- 打印带伤前后的读数 */
/**
 * 天机道 · 预览验收
 *   一 只有天机道看得见;
 *   二 胜算与实战同口径,含携带气血;
 *   三 点出招式的危险时点。
 * 故障注入:把预览改成只看 expeditionRules(不压携带气血),第二条红。
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { usePlayerStore } from '@/stores/player'
import { useEndgameStore, type WorldRunState } from '@/stores/endgame'
import { CELESTIAL_WORLDS } from '@/data/endgame'
import { useInventoryStore } from '@/stores/inventory'
import { RandomService, mulberry32 } from '@/utils/random'
import { previewFight, withCarriedHp } from './expedition'

const seeded = (seed = 5): RandomService => new RandomService(mulberry32(seed))

beforeEach(() => {
  setActivePinia(createPinia())
})

/**
 * 夹具须落在带里(势均才量得出携带气血):裸装打无相天节点三场全负(0.08),两件三场全胜(0.93);
 * 一件时满血 3 胜、残血 2 胜。
 */
function dressOneWeapon(): void {
  const inv = useInventoryStore()
  const item = { uid: 'fx1', templateId: 'w_benyuan', quality: 'divine' as const, tier: 32, level: 5, affixes: [{ id: 'atk4', roll: 1 }, { id: 'hp4', roll: 1 }, { id: 'def4', roll: 1 }] }
  inv.items = [item] // 重摆不追加:一个用例调用两次,追加会变成两件
  inv.equip('fx1', 'weapon')
}

/** 天机道玩家 + 打到第 2 重的远征 */
function fateRun(carriedHpPct: number, worldId = 'wuxiang', major = 14): WorldRunState {
  const player = usePlayerStore()
  const endgame = useEndgameStore()
  player.major = major
  endgame.daoPath = 'fate'
  const run = {
    worldId,
    pactId: null,
    gateId: null,
    layer: 1,
    bonus: 0,
    rows: [],
    carriedHpPct,
    totalRounds: 0,
    winStacks: 0
  } as unknown as WorldRunState
  endgame.worldRun = run
  return run
}

describe('天机道 · 预览', () => {
  it('只有天机道看得见 —— 别的道途拿不到这份情报', () => {
    fateRun(1)
    const world = CELESTIAL_WORLDS.find(w => w.id === 'wuxiang')!
    const node = world.routes[1]![0]!
    expect(previewFight(node.foe, node, seeded()), '天机道应当看得见').not.toBeNull()
    useEndgameStore().daoPath = 'sword'
    expect(previewFight(node.foe, node, seeded()), '剑道不该看得见').toBeNull()
  })

  it('预览的胜算与实战同口径:残血时不许比满血更乐观', () => {
    const world = CELESTIAL_WORLDS.find(w => w.id === 'wuxiang')!
    const node = world.routes[1]![0]!

    // 境界取本界的混沌道祖(裸装战力比约 1.5):神人境必败,量不出携带气血。定标见 gauntlet.celestialAnchor
    fateRun(1, 'wuxiang', 20)
    dressOneWeapon()
    const full = previewFight(node.foe, node, seeded(5))!
    fateRun(0.15, 'wuxiang', 20)
    dressOneWeapon()
    const hurt = previewFight(node.foe, node, seeded(5))!

    console.log(`\n同一眼天机:满血 ${full.winText}(${full.rate.toFixed(2)}) · 带一成半气血 ${hurt.winText}(${hurt.rate.toFixed(2)})`)
    expect(
      hurt.rate,
      `带一成半气血的预览报「${hurt.winText}」,与满血「${full.winText}」一样乐观 —— 携带气血没算进去`
    ).toBeLessThan(full.rate)
  })

  it('压上携带气血的规则就是实战规则:开局气血取「世界上限」与「携带气血」的较小者', () => {
    const run = fateRun(0.4)
    const chiyan = CELESTIAL_WORLDS.find(w => w.id === 'chiyan')!
    const base = { ...chiyan.rules }
    const capped = withCarriedHp(base, run)
    expect(capped.playerStartHpPct).toBeCloseTo(0.4, 6)
    expect(withCarriedHp(base, { ...run, carriedHpPct: 1 }).playerStartHpPct).toBeCloseTo(1, 6)
    expect(withCarriedHp({ ...base, playerStartHpPct: 0.3 } as typeof base, run).playerStartHpPct).toBeCloseTo(0.3, 6)
  })

  it('它给的是形势,不是答案:招式的危险时点该说说', () => {
    const world = CELESTIAL_WORLDS.find(w => w.id === 'chiyan')!
    // 预览取 run.worldId 那一界的规则
    fateRun(1, 'chiyan')
    const node = world.routes[1]![0]!
    const preview = previewFight(node.foe, node, seeded())!
    expect(preview.skillLines.length, '一眼看不见对面会什么招,那算什么天机').toBeGreaterThan(0)
    // 赤炎天:回合上限骤减、治疗 -35%
    expect(preview.riskLines.join(' / ')).toContain('天时仅')
    expect(preview.riskLines.join(' / ')).toContain('生机稀薄')
  })
})
