/** 装备图标:equipment.ts 的 t() 按名字字眼挑图标;图标键须注册在 ui/icons.ts */
import { describe, expect, it } from 'vitest'
import { EQUIPMENT_TEMPLATES, equipmentTemplate } from './equipment'
import { ICONS } from '@/ui/icons'

describe('装备图标', () => {
  it('全部模板的图标键都已注册,没有死键', () => {
    // 须直接查注册表:iconOf 兜底成 Sparkles、永不抛错,try/catch 测不出死键
    const dead = EQUIPMENT_TEMPLATES.filter(t => !(t.icon in ICONS)).map(t => `${t.id}:${t.icon}`)
    expect(dead, '以下模板的图标键未注册').toEqual([])
  })

  it('同槽不再清一色:衣甲盾、头盔盔、斧用斧、簪用光', () => {
    expect(equipmentTemplate('w_kaifu')?.icon, '开天斧 → 斧').toBe('axe')
    expect(equipmentTemplate('b_hantan')?.icon, '寒潭甲 → 盾').toBe('shield')
    expect(equipmentTemplate('h_yunshen')?.icon, '陨神盔 → 盔(工程盔)').toBe('hardhat')
    expect(equipmentTemplate('h_muzan')?.icon, '桃木簪 → 光点').toBe('sparkles')
    expect(equipmentTemplate('w_xuantie')?.icon, '玄铁重剑 → 剑').toBe('sword')
  })

  it('名字的字眼只作用于自己的槽:剑冢一行不再全变剑、腕甲不再全是盾', () => {
    expect(equipmentTemplate('h_jianwen')?.icon, '剑纹冠 → 冠').toBe('crown')
    expect(equipmentTemplate('b_liuyun')?.icon, '剑痕衣 → 衫').toBe('shirt')
    expect(equipmentTemplate('wr_longlin')?.icon, '剑骨腕甲 → 护腕默认').toBe('watch')
    expect(equipmentTemplate('n_yuehua')?.icon, '剑魄坠 → 玉').toBe('gem')
    expect(equipmentTemplate('tl_jianzhong')?.icon, '剑冢符 → 卷').toBe('scroll')
    expect(equipmentTemplate('wr_moyuan')?.icon, '魔渊腕甲 → 护腕默认').toBe('watch')
    expect(equipmentTemplate('wr_canjia')?.icon, '残甲护腕 → 护腕默认').toBe('watch')
    expect(equipmentTemplate('w_tianguan')?.icon, '天关神钺 → 斧').toBe('axe')
    expect(equipmentTemplate('w_shenge')?.icon, '神戈 → 斧').toBe('axe')
    expect(equipmentTemplate('w_youhai')?.icon, '幽海钩 → 锚').toBe('anchor')
  })

  it('手挑过的图标不算(雾隐长枪仍用 wand),不被关键词规则覆盖', () => {
    expect(equipmentTemplate('w_zidian')?.icon).toBe('wand')
  })

  it('衣甲与衣袍同槽并存:寒潭甲盾牌、风林道袍衬衫', () => {
    expect(equipmentTemplate('b_hantan')?.icon).toBe('shield')
    expect(equipmentTemplate('b_qingyun')?.icon).toBe('shirt')
  })
})
