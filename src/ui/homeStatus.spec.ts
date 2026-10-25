import { describe, expect, it } from 'vitest'
import { homeStatusText, type HomePresence } from './homeStatus'

function presence(over: Partial<HomePresence> = {}): HomePresence {
  return {
    dead: false,
    exploringSecret: false,
    expedition: false,
    adventuring: false,
    regionName: '',
    injured: false,
    retreating: false,
    expFull: false,
    ...over
  }
}

describe('主页状态行', () => {
  it('默认是修炼,不是闭关', () => {
    expect(homeStatusText(presence())).toBe('修炼中')
  })

  it('只有闭关增益在身时才写闭关', () => {
    expect(homeStatusText(presence({ retreating: true }))).toBe('闭关中')
  })

  it('修为圆满单独成句,避免和闭关混成一句', () => {
    expect(homeStatusText(presence({ expFull: true }))).toBe('修为已至圆满')
  })

  it('疗伤优先于闭关:伤势比封洞更需要看见', () => {
    expect(homeStatusText(presence({ injured: true, retreating: true }))).toBe('疗伤中')
  })

  it('历练带上地界名', () => {
    expect(homeStatusText(presence({ adventuring: true, regionName: '青云山麓' }))).toBe('历练在途 · 青云山麓')
  })

  it('秘境里写「身在秘境」,不写修炼中', () => {
    expect(homeStatusText(presence({ exploringSecret: true }))).toBe('身在秘境')
  })

  it('远征在外写远征在途,且比历练会话优先', () => {
    expect(
      homeStatusText(presence({ expedition: true, adventuring: true, regionName: '青云山麓' }))
    ).toBe('远征在途')
  })

  it('陨落压过其余一切', () => {
    expect(
      homeStatusText(presence({ dead: true, exploringSecret: true, expedition: true, adventuring: true, regionName: '青云山麓' }))
    ).toBe('陨落')
  })
})
