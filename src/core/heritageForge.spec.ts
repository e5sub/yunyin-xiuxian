/** 宿命传承机制回归(结构断言红线);用例 ①~⑧ 为承继自 xian 的评审判据 */
import { describe, expect, it, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { HERITAGE_DEFS, heritageDef, type HeritageDef } from '@/data/heritage'
import { forgeCandidate, lifeForge } from './heritageForge'
import { HERITAGE } from './samsaraAudit'
import { usePlayerStore } from '@/stores/player'
import { useResourcesStore } from '@/stores/resources'

/**
 * 非倍率红线禁词(仅测试期静态守卫,不进运行时数据):传承名号/文案/机制描述出现即判负;
 * 可折算成攻防/修速/战力倍率即塌回「深修指数补偿」陷阱。
 */
const FORBIDDEN = [
  '攻速',
  '攻',
  '防御',
  '修速',
  '修炼速度',
  '倍率',
  '战力',
  '伤害',
  '暴击',
  '百分比',
  '气血加成',
  '加成',
  '+',
  '%'
] as const

function aura(d: HeritageDef): string {
  return `${d.name} ${d.desc} ${d.effectDesc}`
}

describe('宿命传承 · 锻造生命周期', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('① 门槛:forgeCandidate 只返回 gateMajor<=major 的未锻造传承;浅修(major<2)永不返回', () => {
    expect(forgeCandidate(0)).toEqual([])
    expect(forgeCandidate(1)).toEqual([])
    expect(forgeCandidate(2).map(d => d.id)).toEqual(['danxin'])
    for (const d of forgeCandidate(9)) expect(d.gateMajor).toBeLessThanOrEqual(9)
    const player = usePlayerStore()
    player.addHeritage('danxin')
    expect(forgeCandidate(2).map(d => d.id)).toEqual([])
  })

  it('② 一世一悟:同世到达多个未锻造门槛,只锻造最高那一个(不滚雪球)', () => {
    expect(lifeForge(2)!.id).toBe('danxin')
    expect(lifeForge(5)!.id).toBe('tonggan')
    expect(lifeForge(9)!.id).toBe('daoben')
  })

  it('③ 浅修农场反例:哪怕转世几百世,只要每世冲不到金丹,一道也锻不出', () => {
    const forged: string[] = []
    // 每世只到筑基(major 1)
    for (let life = 0; life < 200; life += 1) {
      const f = lifeForge(1)
      if (f) forged.push(f.id)
    }
    expect(forged).toEqual([])
  })

  it('④ 跨世持久:锻造后 rebirth 不清空 heritage,只清空每世用量', () => {
    const player = usePlayerStore()
    player.addHeritage('danxin')
    player.addHeritage('dubu')
    expect(player.consumeHeritageUse('dubu', 1)).toBe(true)
    expect(player.reincarnation.heritageUses['dubu']).toBe(1)
    expect(player.consumeHeritageUse('dubu', 1)).toBe(false)
    player.rebirth(player.linggen!)
    expect(player.reincarnation.heritage).toContain('danxin')
    expect(player.reincarnation.heritage).toContain('dubu')
    expect(player.reincarnation.count).toBe(1)
    expect(player.reincarnation.heritageUses).toEqual({})
  })

  it('⑤ 非倍率红线:任何传承的名号/文案/机制描述不得含攻防/修速/倍率等词', () => {
    for (const d of HERITAGE_DEFS) {
      for (const kw of FORBIDDEN) {
        expect(aura(d), `${d.id} 含禁词「${kw}」`).not.toContain(kw)
      }
    }
  })

  it('⑤b 结构红线:effect 一律 bounded-flat、门槛不低于金丹、轴属选择/容错/荣誉', () => {
    expect(HERITAGE_DEFS.length).toBeGreaterThanOrEqual(3)
    for (const d of HERITAGE_DEFS) {
      expect(d.effect, `${d.id} 必须是有界平直的能力位`).toBe('bounded-flat')
      expect(d.gateMajor, `${d.id} 金丹以下锻不出`).toBeGreaterThanOrEqual(2)
      expect(['choice', 'fault-tolerant', 'honor'], `${d.id} 轴越界`).toContain(d.axis)
      expect(heritageDef(d.id)).toBe(d)
    }
  })

  it('⑥ 遗产覆盖度量:samsaraAudit 的 HERITAGE 已登记 heritage 一行(kind=legacy, mode=full)', () => {
    const row = HERITAGE.find(r => r.id === 'heritage')
    expect(row).toBeDefined()
    expect(row!.kind).toBe('legacy')
    expect(row!.mode).toBe('full')
    expect(row!.compressesGrowth).toBe(false)
  })

  it('⑦ 白费注入:红线扫描器能拦下「偷偷写成倍率」的传承(证明这条断言不是空转)', () => {
    const sneaky: HeritageDef = {
      id: 'evil',
      name: '睥睨' /* 名字干净 */,
      gateMajor: 2,
      effect: 'bounded-flat',
      axis: 'honor',
      desc: '修炼速度提升 15%',
      effectDesc: '攻防各 +5%'
    }
    const hit = FORBIDDEN.find(kw => aura(sneaky).includes(kw))
    expect(hit, '扫描器未命中恶意倍率词条,红线形同虚设').toBeDefined()
  })

  it('⑧ 经济不变量:forge 判定是纯计算,调用不改任何资源流与存量', () => {
    const player = usePlayerStore()
    const resources = useResourcesStore()
    const daoBefore = player.reincarnation.daoFruit
    const heritageBefore = [...player.reincarnation.heritage]
    const usesBefore = { ...player.reincarnation.heritageUses }
    forgeCandidate(9)
    lifeForge(9)
    expect(player.reincarnation.daoFruit).toBe(daoBefore)
    expect(player.reincarnation.heritage).toEqual(heritageBefore)
    expect(player.reincarnation.heritageUses).toEqual(usesBefore)
    expect(resources.spiritStone).toBeDefined()
  })
})
