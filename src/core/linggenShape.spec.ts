/**
 * 灵根画像的形状修复。只测纯函数、不建 Pinia(分层判据:core 用例带 Pinia
 * 的文件数只许减);store 侧见 stores/linggenShape.spec.ts。
 */
import { describe, expect, it } from 'vitest'
import { sanitizeLinggen } from './linggenGen'
import { ELEMENTS } from '@/data/linggen'

describe('灵根画像 · 读档形状修复', () => {
  it('认不出的元素整根剔掉,留下的每一根都能取到元素元数据', () => {
    const fixed = sanitizeLinggen({
      roots: [
        { element: 'metal', aptitude: 80 },
        { element: 'bogus', aptitude: 70 },
        { element: 'fire', aptitude: 60 }
      ],
      gradeName: '真灵根',
      growthMult: 1.35
    })
    expect(fixed?.roots.map(r => r.element), '野元素不参与展示也不参与亲和').toEqual(['metal', 'fire'])
    for (const r of fixed!.roots) expect(ELEMENTS[r.element].char, '元素元数据必须取得到').toBeTruthy()
    expect(fixed!.growthMult).toBe(1.35)
  })

  it('坏倍率回落 1、坏资质夹回 1~100,配对文案缺失时给一个能读的名', () => {
    const fixed = sanitizeLinggen({
      roots: [
        { element: 'water', aptitude: Number.NaN },
        { element: 'earth', aptitude: -5 },
        { element: 'wind', aptitude: 999 }
      ],
      gradeName: '',
      growthMult: null
    })
    expect(fixed!.roots.map(r => r.aptitude), '坏资质不让「资质 NaN」印到脸上').toEqual([1, 1, 100])
    expect(fixed!.growthMult, '倍率缺失时与 linggen?.growthMult ?? 1 同一口径').toBe(1)
    expect(fixed!.gradeName, '空名会让标题只剩一片空白').toBe('灵根')
  })

  it('一根灵根都不剩(或整份不是对象)时整份作废,建号页可重新掷牌', () => {
    expect(sanitizeLinggen({ roots: [{ element: 'bogus', aptitude: 30 }] })).toBeNull()
    expect(sanitizeLinggen({ roots: 'x' })).toBeNull()
    expect(sanitizeLinggen(null)).toBeNull()
    expect(sanitizeLinggen([])).toBeNull()
  })
})
