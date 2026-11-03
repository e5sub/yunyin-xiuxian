/**
 * 存档归一化的判据 —— 服务端落库前跑的就是这套。
 *
 * 要守的三件事:
 *  1. 合法档一字不动(否则每次上传都在偷玩家东西:时间戳、键顺序、数字精度);
 *  2. 越界项按玩法链钳回(超品阶 / 超强化 / 超词条 / 野 id / 坏大数);
 *  3. 幂等(归一化两遍与一遍同结果),否则服务端与客户端会来回震。
 */
import { describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { SAVE_SANITIZE_STEPS, sanitizeSaveSlices } from './saveSanitize'
import { AFFIXES, affixFitBlock } from '@/data/affixes'
import { EQUIPMENT_TEMPLATES } from '@/data/equipment'
import { EQUIP_MAX_LEVEL_BASE } from '@/data/constants'
import { SAVE_GNUM_MAX_EXP } from '@/utils/saveShape'

/** 各分片默认态拼出的档:等价于开局第一秒的存档,字段齐全但没有任何进度 */
function seedSave(): Record<string, unknown> {
  setActivePinia(createPinia())
  try {
    const out: Record<string, unknown> = {}
    for (const step of SAVE_SANITIZE_STEPS) out[step.slice] = JSON.parse(JSON.stringify((step.use() as unknown as { $state: unknown }).$state))
    return out
  } finally {
    setActivePinia(undefined)
  }
}

function inventoryOf(data: Record<string, unknown>): Record<string, unknown> {
  return data.inventory as Record<string, unknown>
}

describe('存档归一化 · 合法档不受影响', () => {
  it('归一化两遍与一遍同结果(幂等)', () => {
    const once = sanitizeSaveSlices(seedSave())
    expect(once).not.toBeNull()
    const twice = sanitizeSaveSlices(once!.data)
    expect(twice!.data).toEqual(once!.data)
    expect(twice!.touched).toEqual([])
  })

  it('未被改动的分片保持原样(连键顺序都不动)', () => {
    const seed = seedSave()
    const result = sanitizeSaveSlices(seed)
    expect(result).not.toBeNull()
    for (const key of Object.keys(seed)) {
      if (result!.touched.includes(key)) continue
      expect(JSON.stringify(result!.data[key])).toBe(JSON.stringify(seed[key]))
    }
  })

  it('未登记的分片原样保留,不替玩家删字段', () => {
    const result = sanitizeSaveSlices({ somethingNew: { a: 1 } })
    expect(result!.data).toEqual({ somethingNew: { a: 1 } })
    expect(result!.touched).toEqual([])
  })

  it('非对象输入返回 null(调用方按原样处理)', () => {
    expect(sanitizeSaveSlices(null)).toBeNull()
    expect(sanitizeSaveSlices([])).toBeNull()
    expect(sanitizeSaveSlices('x')).toBeNull()
  })
})

describe('存档归一化 · 越界项按玩法链钳回', () => {
  /** 在种子档上挂一件装备;patch 覆写指定字段 */
  function withItem(patch: Record<string, unknown>): Record<string, unknown> {
    const seed = seedSave()
    const template = EQUIPMENT_TEMPLATES.find(t => t.slot === 'weapon')!
    inventoryOf(seed).items = [
      {
        uid: 'u1',
        templateId: template.id,
        quality: 'mortal',
        tier: 1,
        level: 0,
        affixes: [],
        locked: false,
        reforgeCount: 0,
        sealedAffixIds: [],
        transferCount: 0,
        ...patch
      }
    ]
    return seed
  }

  it('超品阶/超强化等级被钳回', () => {
    const result = sanitizeSaveSlices(withItem({ tier: 999, level: 99_999 }))!
    const item = (inventoryOf(result.data).items as Array<Record<string, unknown>>)[0]!
    expect(item.tier).toBeLessThanOrEqual(40)
    // 洞府没起炼器台时上限就是基础上限,改包写 25 级不该算进属性
    expect(item.level).toBe(EQUIP_MAX_LEVEL_BASE)
    expect(result.touched).toContain('inventory')
  })

  it('词条条数按品质上限收口(凡品只 1 条)', () => {
    // 用 16 条**各不相同**且装得上的词条:同 id 重复会先被去重,测不到「按品质上限收口」这一层
    const tpl = EQUIPMENT_TEMPLATES.find(t => t.slot === 'weapon')!
    const ids = AFFIXES.filter(a => affixFitBlock(a, tpl.slot, 0) === null)
      .slice(0, 16)
      .map(a => a.id)
    expect(ids.length).toBe(16)
    const result = sanitizeSaveSlices(withItem({ affixes: ids.map(id => ({ id, roll: 1 })) }))!
    const item = (inventoryOf(result.data).items as Array<Record<string, unknown>>)[0]!
    expect((item.affixes as unknown[]).length).toBe(1)
  })

  /**
   * 形状合法但不适配的词条要被剔掉 —— 这是「完美词条组合」唯一还剩的入口:
   * 条数与 roll 早就钳住了,可凡品武器挂六条传世词条一直能过秤,再被台账播种成「合法旧物」。
   */
  it('部位不符 / 品质门槛不够的词条被剔除', () => {
    const template = EQUIPMENT_TEMPLATES.find(t => t.slot === 'weapon')!
    const offSlot = AFFIXES.find(a => a.slots !== undefined && !a.slots.includes(template.slot))!
    const rankGated = AFFIXES.find(
      a => (a.minRank ?? 0) > 0 && (!a.slots || a.slots.includes(template.slot))
    )!
    const strip = (affixes: unknown[]): string[] => {
      const result = sanitizeSaveSlices(withItem({ templateId: template.id, quality: 'mortal', affixes }))!
      const item = (inventoryOf(result.data).items as Array<Record<string, unknown>>)[0]!
      return (item.affixes as Array<{ id: string }>).map(a => a.id)
    }
    expect(strip([{ id: offSlot.id, roll: 1 }])).toEqual([])
    expect(strip([{ id: rankGated.id, roll: 1 }])).toEqual([])
    // 反向:装得上的那条一条不少(否则这层就是在无差别剪玩家词条)
    const fit = AFFIXES.find(
      a => (!a.slots || a.slots.includes(template.slot)) && (a.minRank ?? 0) <= 0
    )!
    expect(strip([{ id: fit.id, roll: 1 }])).toEqual([fit.id])
  })

  it('野装备模板/野词条/坏大数指数都被清掉', () => {
    const seed = withItem({
      templateId: 'not-a-template',
      affixes: [{ id: 'no-such-affix', roll: 5 }]
    })
    ;(seed.resources as Record<string, unknown>).spiritStone = { m: 9.99, e: SAVE_GNUM_MAX_EXP + 1 }
    const result = sanitizeSaveSlices(seed)!
    const item = (inventoryOf(result.data).items as Array<Record<string, unknown>>)[0]!
    expect((item.affixes as unknown[]).length).toBe(0)
    expect((result.data.resources as Record<string, unknown>).spiritStone).toEqual({ m: 0, e: 0 })
    expect(result.touched).toContain('resources')
  })

  it('境界越界被夹回境界表上限', () => {
    const seed = seedSave()
    ;(seed.player as Record<string, unknown>).major = 9999
    ;(seed.player as Record<string, unknown>).sub = 9999
    const result = sanitizeSaveSlices(seed)!
    const player = result.data.player as Record<string, unknown>
    expect(player.major).toBeLessThanOrEqual(28)
    expect(player.sub).toBeLessThanOrEqual(9)
  })

  it('修为超过本境界突破所需若干倍被钳回(改修为等于改境界)', () => {
    const seed = seedSave()
    const player = seed.player as Record<string, unknown>
    player.major = 1
    player.sub = 0
    player.exp = { m: 1, e: 500 }
    const result = sanitizeSaveSlices(seed)!
    const exp = (result.data.player as Record<string, unknown>).exp as { m: number; e: number }
    expect(exp.e).toBeLessThan(500)
    expect(result.touched).toContain('player')
  })

  it('灵石指数与灵草数量按量级护栏收口', () => {
    const seed = seedSave()
    const resources = seed.resources as Record<string, unknown>
    resources.spiritStone = { m: 9.9, e: 500 }
    resources.herbByGrade = { 1: 5e9, 2: 0, 3: 0, 4: 0, 5: 0 }
    const result = sanitizeSaveSlices(seed)!
    const fixed = result.data.resources as Record<string, unknown>
    expect(fixed.spiritStone).toEqual({ m: 9.99, e: 150 })
    expect((fixed.herbByGrade as Record<string, number>)['1']).toBe(1e9)
  })
})
