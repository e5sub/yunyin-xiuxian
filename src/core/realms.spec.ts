/** 境界体系结构审计:内容 gate / 存档 / 审计都建立在境界下标之上 */
import { describe, expect, it } from 'vitest'
import {
  REALMS,
  WORLDS,
  MAX_MAJOR,
  WORLD_BREAK_MAJOR,
  REBIRTH_REFERENCE_MAJOR,
  realmDef,
  realmLabel,
  worldOf,
  worldDef,
  isWorldEntry
} from '@/data/realms'

/** 0-9 号境界冻结:id 与名称一字不动(存档、内容 minRealm、审计口径依赖) */
const FROZEN_IDS = ['lianqi', 'zhuji', 'jindan', 'yuanying', 'huashen', 'lianxu', 'heti', 'dacheng', 'dujie', 'zhenxian']
const FROZEN_NAMES = ['炼气', '筑基', '金丹', '元婴', '化神', '炼虚', '合体', '大乘', '渡劫', '真仙']

describe('境界体系 · 结构', () => {
  it('REALMS 与 MAX_MAJOR 自洽,每境字段齐全', () => {
    expect(REALMS.length).toBe(MAX_MAJOR + 1)
    for (const [i, r] of REALMS.entries()) {
      expect(r.id, `第 ${i} 境缺 id`).toBeTruthy()
      expect(r.name, `第 ${i} 境缺 name`).toBeTruthy()
      expect(r.desc).toBeTruthy()
      expect(r.lifespanYears, `${r.name} 寿元非正`).toBeGreaterThan(0)
    }
    expect(new Set(REALMS.map(r => r.id)).size, '境界 id 重复').toBe(REALMS.length)
    expect(new Set(REALMS.map(r => r.name)).size, '境界名重复').toBe(REALMS.length)
  })

  it('0-9 号境界冻结:id/名称与扩界前一字不差', () => {
    for (let i = 0; i < FROZEN_IDS.length; i += 1) {
      expect(REALMS[i]!.id, `第 ${i} 境 id 被改动`).toBe(FROZEN_IDS[i])
      expect(REALMS[i]!.name, `第 ${i} 境名称被改动`).toBe(FROZEN_NAMES[i])
    }
  })

  it('界域是 0..MAX 的真划分:有序、无缝、无重叠', () => {
    expect(WORLDS.length).toBeGreaterThanOrEqual(4)
    expect(WORLDS[0]!.start).toBe(0)
    expect(WORLDS[WORLDS.length - 1]!.end).toBe(MAX_MAJOR)
    for (let i = 0; i < WORLDS.length; i += 1) {
      const w = WORLDS[i]!
      expect(w.start, `${w.name} 起点越界`).toBeLessThanOrEqual(w.end)
      expect(w.name).toBeTruthy()
      expect(w.desc).toBeTruthy()
      if (i > 0) {
        expect(w.start, `${WORLDS[i - 1]!.name} 与 ${w.name} 之间有空隙/重叠`).toBe(WORLDS[i - 1]!.end + 1)
      }
      for (let m = w.start; m <= w.end; m += 1) {
        expect(worldOf(m).id, `第 ${m} 境归属错误`).toBe(w.id)
        expect(isWorldEntry(m), `第 ${m} 境入口判定错误`).toBe(m === w.start)
      }
    }
  })

  it('具名常量不自相矛盾:仙界门槛 = 真仙,且为轮回参照终点', () => {
    expect(worldOf(WORLD_BREAK_MAJOR).id).toBe('immortal')
    expect(worldDef('immortal').start).toBe(WORLD_BREAK_MAJOR)
    expect(REALMS[WORLD_BREAK_MAJOR]!.name).toBe('真仙')
    expect(REBIRTH_REFERENCE_MAJOR).toBe(WORLD_BREAK_MAJOR)
  })

  it('大关皆劫:四个跨界入口一视同仁,境界表上不再有「无劫开关」', () => {
    // 规则只有一条(小进阶掷点 / 大关渡劫),无劫开关不许复活;行为侧由 core/breakthrough.spec 覆盖
    // 人间界入口炼气(0)是起点,不是要渡的关
    for (const w of WORLDS.slice(1)) {
      expect(w.start, `${w.name} 的入口落在炼气 —— 那一境没有可渡的关`).toBeGreaterThan(0)
    }
    expect('tribulation' in REALMS[WORLD_BREAK_MAJOR]!, '境界表上又长回了无劫开关').toBe(false)
  })

  it('回查函数越界即钳制,不返回空', () => {
    expect(realmDef(-5).id).toBe(REALMS[0]!.id)
    expect(realmDef(999).id).toBe(REALMS[MAX_MAJOR]!.id)
    expect(realmLabel(0, -1)).toContain(REALMS[0]!.name)
    expect(realmLabel(MAX_MAJOR, 999)).toContain(REALMS[MAX_MAJOR]!.name)
  })

  // ---- 可解释性:每一境都要有命名出处 ----

  it('每一境都有可解释的命名出处(非空、够长)', () => {
    for (const r of REALMS) {
      expect(r.lore, `${r.name} 缺命名出处说明`).toBeTruthy()
      expect(r.lore.length, `${r.name} 的出处说明过短`).toBeGreaterThanOrEqual(12)
      expect(new Set(REALMS.map(x => x.lore)).size, '出处说明重复').toBe(REALMS.length)
    }
  })

  it('界域与出处类别自洽:人界内丹/佛道、仙界道教仙阶、神界网文、混沌海与太初道家本源', () => {
    const allowed: Record<string, string[]> = {
      mortal: ['内丹', '佛道'],
      immortal: ['道教仙阶'],
      god: ['网文', '道家本源'],
      chaos: ['道家本源'],
      primordial: ['道家本源']
    }
    for (const r of REALMS) {
      expect(allowed[r.world], `${r.name} 的出处「${r.basis}」与界域「${r.world}」不符`).toContain(r.basis)
    }
  })

  it('寿元随境界单调增长,且每一境至少翻倍(渡劫→真仙为飞升之大跃)', () => {
    for (let i = 1; i <= MAX_MAJOR; i += 1) {
      const prev = REALMS[i - 1]!.lifespanYears
      const cur = REALMS[i]!.lifespanYears
      expect(cur, `${REALMS[i]!.name} 寿元未高于 ${REALMS[i - 1]!.name}`).toBeGreaterThanOrEqual(prev * 2)
    }
    // 飞升是全流程唯一的寿元大跃
    const dujie = REALMS[WORLD_BREAK_MAJOR - 1]!.lifespanYears
    expect(REALMS[WORLD_BREAK_MAJOR]!.lifespanYears / dujie).toBeGreaterThanOrEqual(10)
  })
})
