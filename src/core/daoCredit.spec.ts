/**
 * 道源额度尺的守卫(1.74.1)。
 *
 * 这把尺的用途是「不让正常通关的道源被窗口上限削掉」,所以唯一必须成立的不变量是:
 * **额度 ≥ 任何一次真实结算能拿到的道源**。差一点都不行 —— 差的那一点正好是玩家被压回的量。
 * 反向也不能放太宽:额度只放宽上限,多加一份就是给改包多留一份增量空间。
 */
import { describe, expect, it } from 'vitest'
import { CELESTIAL_WORLDS, TRIALS } from '@/data/endgame'
import { PACTS } from '@/data/pacts'
import { slaughterSpeedBonus } from '@/core/daoDepth'
import { MUTATION_BASE_REWARD } from '@/core/expedition'
import { daoMarkCeil } from '@/core/daoCredit'

/** 远征结算:`floor((界赏 + 沿途 bonus) × 契约倍率 × (1 + 速战之赏))`,与 core/expedition 同一式 */
function expeditionReward(worldId: string, pactMult: number, routeBonus: number, speed: number): number {
  const world = CELESTIAL_WORLDS.find(w => w.id === worldId)!
  return Math.floor((world.rewardDaoSource + routeBonus) * pactMult * (1 + speed))
}

describe('道痕道源额度', () => {
  it('每一界的额度都盖得住「最高契约 + 最肥路线 + 最快速战」', () => {
    for (const world of CELESTIAL_WORLDS) {
      // 沿途 bonus 逐层取两条路里大的那条 —— 玩家确实可能挑最肥的走
      let fatRoute = 0
      for (const layer of world.routes) fatRoute += Math.max(...layer.map(n => n.bonus))
      const speed = Math.max(slaughterSpeedBonus(0, 1), slaughterSpeedBonus(0, 5))
      for (const pact of PACTS) {
        const worst = expeditionReward(world.id, pact.sourceMult, fatRoute, speed)
        expect(
          daoMarkCeil(world.id),
          `${world.name} × 契约「${pact.name}」最肥路线结算 ${worst},额度只有 ${daoMarkCeil(world.id)}`
        ).toBeGreaterThanOrEqual(worst)
      }
    }
  })

  it('额度不至于是收益的好几倍(放宽上限不是白送钱)', () => {
    for (const world of CELESTIAL_WORLDS) {
      const plain = expeditionReward(world.id, 1, 0, 0)
      expect(daoMarkCeil(world.id), `${world.name} 的额度 ${daoMarkCeil(world.id)} 远超素手通关的 ${plain}`).toBeLessThan(
        plain * 15
      )
    }
  })

  it('试炼按自己的固定赏格,不吃契约倍率', () => {
    for (const trial of TRIALS) {
      expect(daoMarkCeil(trial.id), trial.name).toBe(trial.rewardDaoSource)
    }
  })

  it('天道变数的额度与 core/expedition 的固定赏格同值', () => {
    expect(daoMarkCeil('mutation')).toBe(MUTATION_BASE_REWARD)
  })

  it('挑战书的额度盖得住验价上界(core/challenge 的 45 × 1.9)', () => {
    expect(daoMarkCeil('custom')).toBeGreaterThanOrEqual(Math.round(45 * 1.9))
  })

  it('认不出的 targetId 一律 0:没有出处就不给额度', () => {
    expect(daoMarkCeil('')).toBe(0)
    expect(daoMarkCeil('wild_world')).toBe(0)
    expect(daoMarkCeil('重写·赤炎天')).toBe(0)
  })
})
