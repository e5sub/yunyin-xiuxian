/* eslint-disable no-console */
/** 收窄后果审计:覆盖比例(浅轮回能推进多少)与互斥度(深修独有占比) */
import { describe, expect, it } from 'vitest'
import { ASSETS, coverageAfter, coverageInsightVeinsOnly, coverageNow, deepExclusive, movedOut } from './narrowingImpact'

const fmt = (c: ReturnType<typeof coverageNow>): string =>
  `覆盖 ${c.shallow}/${c.total}(${(c.ratio * 100).toFixed(0)}%) · 深修独有 ${c.deepOnly}/${c.total}(${(c.exclusivity * 100).toFixed(0)}%)`

describe('收窄后果 · 覆盖比例', () => {
  it('三种情形的对照', () => {
    console.log(`\n现状:       ${fmt(coverageNow())}`)
    console.log(`只移两项:   ${fmt(coverageInsightVeinsOnly())}`)
    console.log(`定案(移三): ${fmt(coverageAfter())}`)
    console.log('\n逐项:')
    for (const a of ASSETS) {
      console.log(
        `  ${a.name.padEnd(12)} 现浅${a.shallowNow ? '✓' : '✗'} 后浅${a.shallowAfter ? '✓' : '✗'} ` +
          `深${a.deep ? '✓' : '✗'} [${a.action}]  ${a.note}`
      )
    }
  })

  it('现状确认:金丹循环覆盖近八成永久资产', () => {
    const now = coverageNow()
    expect(now.ratio).toBeGreaterThan(0.75)
    // 深修独有:高阶认知、道源道痕
    expect(now.deepOnly).toBe(2)
  })

  it('只移宿慧与灵脉停在五成半,进不了目标区间', () => {
    // 目标区间 38%~50%;中间方案 5/9 = 56%
    const mid = coverageInsightVeinsOnly()
    expect(mid.ratio).toBeGreaterThan(0.5)
    console.log(`\n只移两项 ${(mid.ratio * 100).toFixed(0)}%,尚未进入 38%~50% 的目标区间`)
  })

  it('定案追加移出先天之姿,覆盖降到四成四并进入目标区间', () => {
    const now = coverageNow()
    const after = coverageAfter()
    expect(after.ratio).toBeLessThan(0.5)
    expect(after.ratio).toBeGreaterThan(0.38)
    expect(after.exclusivity).toBeGreaterThan(now.exclusivity * 1.9)
    console.log(
      `\n覆盖 ${(now.ratio * 100).toFixed(0)}% → ${(after.ratio * 100).toFixed(0)}%,` +
        `互斥度 ${(now.exclusivity * 100).toFixed(0)}% → ${(after.exclusivity * 100).toFixed(0)}%`
    )
  })

  it('首次出现「深修独有多于浅轮回可得」的格局', () => {
    const after = coverageAfter()
    expect(after.exclusivity).toBeGreaterThan(0.5)
    expect(after.deepOnly).toBeGreaterThan(after.shallow)
    console.log(`\n定案:${fmt(after)}——深修独有首次超过浅轮回可得`)
  })
})

describe('收窄后果 · 互斥收益面', () => {
  it('收窄后深修独有五项,首次形成可辨识的另一条路线', () => {
    const list = deepExclusive().map(a => a.name)
    expect(list).toHaveLength(5)
    expect(list).toContain('宿慧')
    expect(list).toContain('灵脉')
    expect(list).toContain('先天之姿')
    expect(list).toContain('高阶认知')
    expect(list).toContain('道源与道痕')
    console.log(`\n深修独有:${list.join('、')}`)
  })

  it('浅轮回仍保住四项,不至于变成纯功利计算', () => {
    const kept = ASSETS.filter(a => a.shallowAfter).map(a => a.name)
    expect(kept).toHaveLength(4)
    expect(kept).toContain('道果')
    expect(kept).toContain('灵兽')
    expect(kept).toContain('成就与图鉴')
    expect(kept).toContain('基础认知')
    console.log(`\n浅轮回保留:${kept.join('、')}——留住「活过一世总有所得」的感觉`)
  })

  it('移出的三项都符合「无界或短周期却影响长期」的特征', () => {
    const out = movedOut()
    expect(out.map(a => a.name)).toEqual(['宿慧', '先天之姿', '灵脉'])
    for (const a of out) expect(a.action).toBe('move')
  })
})

describe('收窄后果 · 一个容易搞错的前提', () => {
  it('深修路过金丹,故浅能拿的深也能拿——互斥不在「能否」而在「效率」', () => {
    for (const a of ASSETS) {
      if (a.shallowAfter) expect(a.deep).toBe(true)
    }
  })

  it('师承是唯一不属于任何一条路线的资产——一次性历史', () => {
    const mentor = ASSETS.find(a => a.id === 'mentor')!
    expect(mentor.action).toBe('onetime')
    expect(mentor.shallowNow).toBe(false)
    expect(mentor.deep).toBe(false)
  })

  it('高阶认知的边界现状即已存在,收窄只是把它写明', () => {
    const deepLore = ASSETS.find(a => a.id === 'loreDeep')!
    expect(deepLore.shallowNow).toBe(false)
    expect(deepLore.shallowAfter).toBe(false)
    expect(deepLore.action).toBe('split')
  })
})
