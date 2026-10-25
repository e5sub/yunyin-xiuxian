import { describe, it, expect } from 'vitest'
import { personalityEffects, personalityDesc, PERSONALITY_NAMES } from './petPersonality'
import { PETS, petDef } from '@/data/pets'

describe('灵兽性格(personality)', () => {
  it('每只灵兽都有性格,且性格名齐全', () => {
    for (const p of PETS) {
      expect(PERSONALITY_NAMES[p.personality]).toBeTruthy()
      expect(petDef(p.id)?.personality).toBe(p.personality)
    }
  })

  it('性格效果区分明显:贪宝更易掉宝,好战更险,谨慎更稳', () => {
    const greedy = personalityEffects('pet_qingyu')
    const fierce = personalityEffects('pet_huoque')
    const cautious = personalityEffects('pet_yueying')
    expect(greedy.dropLuck).toBeGreaterThan(cautious.dropLuck)
    expect(fierce.dangerMult).toBeGreaterThan(cautious.dangerMult)
    expect(cautious.lossReduction).toBeGreaterThan(fierce.lossReduction)
  })

  it('慢稳历练更久', () => {
    const steady = personalityEffects('pet_xuegui')
    expect(steady.exploreDurMult).toBeGreaterThan(1)
    expect(personalityEffects(null).exploreDurMult).toBe(1)
  })

  it('性格描述只报真实效果,不另许战斗收益或机缘', () => {
    const kinds = ['greedy', 'steady', 'fierce', 'cautious'] as const
    for (const k of kinds) {
      const text = personalityDesc(k)
      const e = personalityEffects(
        PETS.find(p => p.personality === k)!.id
      )
      expect(text, k).not.toContain('收益')
      expect(text, k).not.toContain('机缘')
      if (e.dropLuck !== 0) expect(text, k).toContain('成色')
      if (e.dangerMult !== 1) expect(text, k).toContain('遇险')
      if (e.exploreDurMult !== 1) expect(text, k).toContain('行程')
      if (e.lossReduction > 0) expect(text, k).toContain('护持')
    }
  })

  it('灵兽风味不把同程遇敌说成寻机缘,不把战利灵石说成聚财', () => {
    for (const p of PETS) {
      expect(p.desc, p.id).not.toContain('机缘')
      expect(p.desc, p.id).not.toContain('聚财')
      if (p.desc.includes('九万里')) expect(p.desc, p.id).toContain('行程不减')
    }
  })

  it('petDef 回查正常', () => {
    expect(petDef('pet_qingyu')?.personality).toBe('greedy')
  })
})
