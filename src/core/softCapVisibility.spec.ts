/** 折扣率一律从 SOFT_CAPS 读,视图里手抄一个「折半」就会红:各键 diminish 不同(0.5 / 0.4) */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { SOFT_CAPS } from '@/data/constants'
import { isSoftCapped, mergeMods } from '@/core/statsCalc'
import { STAT_KEYS } from '@/data/statNames'
import type { AnyStatKey } from '@/types'

/** 去掉注释:注释里的提及不算接上 */
function stripComments(src: string): string {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
}

const CHAR_VIEW_SRC = stripComments(readFileSync(resolve(__dirname, '../views/CharacterView.vue'), 'utf8'))

const CAPPED_KEYS = Object.keys(SOFT_CAPS) as AnyStatKey[]

describe('软上限:机制本体', () => {
  it('越过 cap 的部分按 diminish 折算,不是直接砍平', () => {
    for (const key of CAPPED_KEYS) {
      const rule = SOFT_CAPS[key]!
      const raw = rule.cap + 0.5
      const merged = mergeMods([{ [key]: raw } as { [k in AnyStatKey]?: number }])
      const got = merged[key]!
      expect(got, `${key} 超出部分应按 ${rule.diminish} 折算`).toBeCloseTo(rule.cap + 0.5 * rule.diminish, 6)
      expect(got, `${key} 折算后仍应高于 cap(不是砍回 cap)`).toBeGreaterThan(rule.cap)
    }
  })

  it('标记与机制同真同假:说「软」就是真在被折算', () => {
    for (const key of CAPPED_KEYS) {
      const rule = SOFT_CAPS[key]!
      const under = mergeMods([{ [key]: rule.cap - 0.01 } as { [k in AnyStatKey]?: number }])
      const over = mergeMods([{ [key]: rule.cap + 0.2 } as { [k in AnyStatKey]?: number }])
      expect(isSoftCapped(under, key), `${key} 未过 cap 不该标软`).toBe(false)
      expect(isSoftCapped(over, key), `${key} 越过 cap 该标软`).toBe(true)
    }
  })
})

describe('软上限:人物页真的标出来了', () => {
  it('凡有软阈值的属性,人物页都必须显示(否则无从标记)', () => {
    expect(CHAR_VIEW_SRC, '人物页应遍历 STAT_KEYS,不能再手抄一份白名单').toContain('STAT_KEYS')
    expect(CHAR_VIEW_SRC).not.toMatch(/const MOD_KEYS/)
    for (const key of CAPPED_KEYS) {
      expect(STAT_KEYS, `STAT_NAMES 漏了 ${key}`).toContain(key)
    }
  })

  it('标记与折扣率都走机制本体,不在视图里另写判据', () => {
    expect(CHAR_VIEW_SRC).toContain('isSoftCapped(')
    expect(CHAR_VIEW_SRC).toContain('SOFT_CAPS[')
  })
})
