/* eslint-disable no-console */
import { describe, it, expect } from 'vitest'
import { gn } from '@/utils/gnum'
import { mulberry32, RandomService } from '@/utils/random'
import { resolveCombat, makeEnemySnap } from './combat'
import { buildPlayerSnap } from './playerSnap'
import { enemyDef } from '@/data/enemies'

function baseSnap(over: Partial<ReturnType<typeof buildPlayerSnap>> = {}): ReturnType<typeof buildPlayerSnap> {
  return {
    name: '测试者',
    icon: 'user',
    isPlayer: true,
    attack: gn(100),
    defense: gn(55),
    maxHp: gn(1400),
    speed: 1,
    mods: {},
    skills: [],
    ...over
  }
}

describe('铁壁共鸣(ironwall)', () => {
  it('敌人随玩家属性缩放,玩家无铁壁被击杀时正常败', () => {
    const snap = baseSnap({ maxHp: gn(10), ironwallBrace: false })
    const enemy = makeEnemySnap(enemyDef('e_hmdemon')!, 20, 5)
    const res = resolveCombat(snap, enemy, new RandomService(mulberry32(1)))
    expect(res.win).toBe(false)
  })

  it('带铁壁时致命伤保留 1 血(至少不立即败)', () => {
    const snap = baseSnap({ maxHp: gn(10), ironwallBrace: true })
    const enemy = makeEnemySnap(enemyDef('e_hmdemon')!, 20, 5)
    const res = resolveCombat(snap, enemy, new RandomService(mulberry32(2)))
    // 只保一次命,最终仍可能输
    const logText = res.log.map(l => l.text).join('\n')
    console.log(logText)
    expect(logText.includes('铁壁共鸣')).toBe(true)
  })

  it('铁壁一次性:保命后标记耗尽,不再触发', () => {
    const snap = baseSnap({ maxHp: gn(10), ironwallBrace: true })
    const enemy = makeEnemySnap(enemyDef('e_hmdemon')!, 20, 5)
    const res = resolveCombat(snap, enemy, new RandomService(mulberry32(3)))
    const count = res.log.filter(l => l.text.includes('铁壁共鸣')).length
    expect(count).toBeLessThanOrEqual(1)
  })

  it('同份快照连打两场,每场各自的铁壁都该触发(不能把标记写回快照)', () => {
    // bindSim/buildSearch 复用同一快照连打:resolveCombat 若把 ironwallBrace 写回调用方快照,其后全场失效
    const shared = baseSnap({ maxHp: gn(10), ironwallBrace: true })
    const enemy = makeEnemySnap(enemyDef('e_hmdemon')!, 20, 5)
    const a = resolveCombat(shared, enemy, new RandomService(mulberry32(2)))
    const b = resolveCombat(shared, enemy, new RandomService(mulberry32(2)))
    const braceCount = (r: typeof a) => r.log.filter(l => l.text.includes('铁壁共鸣')).length
    expect(braceCount(a), '第一场铁壁应触发').toBeGreaterThanOrEqual(1)
    expect(braceCount(b), '第二场复用同快照仍应触发,而非被第一场消耗').toBeGreaterThanOrEqual(1)
    expect(shared.ironwallBrace, '调用方快照的铁壁标记应保持原样').toBe(true)
  })
})
