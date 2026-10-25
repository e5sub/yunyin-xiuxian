/**
 * 境界称号:每个大境界一顶。
 * 钉:每个 a_rN 成就给称号;称号在 TITLES 里存在、两境不共用、至少一条词条。
 * 故障注入:去掉任一 a_rN 的 titleId,或让两境指向同一顶称号,本文件红。
 */
import { describe, expect, it } from 'vitest'
import { ACHIEVEMENTS } from '@/data/achievements'
import { TITLES, titleDef } from '@/data/titles'
import { REALMS, MAX_MAJOR } from '@/data/realms'

const REALM_ACHIEVEMENTS = ACHIEVEMENTS.filter(a => a.cond.type === 'realm')

describe('境界称号 · 每一境都有一顶', () => {
  it('每个「突破某境」的成就都给一顶称号', () => {
    const missing: string[] = []
    for (const a of REALM_ACHIEVEMENTS) {
      if (!a.reward?.titleId) missing.push(`a_r${(a.cond as { major: number }).major}(${a.name})`)
    }
    expect(missing, `这些境界的成就没给称号 —— 玩家过完这一境,什么名分也没留下:${missing.join('、')}`).toEqual([])
  })

  it('21 个大境界一个不落(0~20 各有其境成就与称号)', () => {
    const byMajor = new Map(REALM_ACHIEVEMENTS.map(a => [(a.cond as { major: number }).major, a]))
    const missingRealms: string[] = []
    for (let m = 0; m <= MAX_MAJOR; m++) {
      if (!byMajor.get(m)?.reward?.titleId) missingRealms.push(`${m} ${REALMS[m]!.name}`)
    }
    expect(missingRealms, `这些大境界没有境界称号:${missingRealms.join('、')}`).toEqual([])
  })

  it('称号真实存在、两境不共用,且不是空壳', () => {
    const used = new Map<string, number>()
    for (const a of REALM_ACHIEVEMENTS) {
      const id = a.reward?.titleId
      if (!id) continue
      const major = (a.cond as { major: number }).major
      expect(titleDef(id), `a_r${major} 指向了不存在的称号 ${id}`).toBeDefined()
      expect(used.has(id), `称号「${titleDef(id)!.name}」被两个境界共用(${used.get(id)} 与 ${major})`).toBe(false)
      used.set(id, major)
      expect(Object.keys(titleDef(id)!.mods).length, `称号「${titleDef(id)!.name}」是空壳,不给任何属性`).toBeGreaterThan(0)
    }
    expect(used.size, '境界称号数量与境界数对不上').toBe(MAX_MAJOR + 1)
    expect(TITLES.length).toBeGreaterThanOrEqual(used.size)
  })
})
