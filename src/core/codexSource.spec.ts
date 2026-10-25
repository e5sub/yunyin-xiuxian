/**
 * 图鉴来源说明须与真实「收录点」对得上:判据扫源码里的 collect() 调用点,收录模块须对上说明里的路子。
 * 故障注入:把某册说明「历练掉落」改成「宗门赐下」,或把 collect('talent') 挪到别的模块,本文件红。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { CODEX_SOURCES } from '@/ui/codex'
import type { CollectionCategory } from '@/stores/quests'

const SRC = resolve(__dirname, '..')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|vue)$/.test(entry) && !entry.endsWith('.spec.ts')) out.push(full)
  }
  return out
}

/** 某类在哪些模块被 collect(相对 src/ 的路径,正斜杠) */
function collectorsOf(cat: CollectionCategory): string[] {
  const hits: string[] = []
  for (const file of walk(SRC)) {
    const src = readFileSync(file, 'utf8')
    if (new RegExp(`collect\\(\\s*'${cat}'`).test(src)) {
      // Windows 上 join 产出 `core\loot.ts`,机制表是正斜杠,须归一
      hits.push(file.slice(SRC.length + 1).replace(/\\/g, '/'))
    }
  }
  return hits.sort()
}

/** 模块 → 说明里必须出现的字样 */
const MODULE_KEYWORD: Record<string, string> = {
  'core/loot.ts': '掉落',
  'core/gongfaService.ts': '参悟',
  'core/pillService.ts': '炼',
  'core/eventEngine.ts': '际遇',
  'core/reincarnation.ts': '转世'
}

describe('图鉴 · 来源说明与收录点同源', () => {
  const CATS = Object.keys(CODEX_SOURCES) as CollectionCategory[]

  it('每一类都有来源说明,且不是空话', () => {
    for (const cat of CATS) {
      expect(CODEX_SOURCES[cat], `${cat} 没有来源说明 —— 那一册的「???」就成了死胡同`).toMatch(/^来源:/)
    }
  })

  it('说明里提的路子,就是 collect 真正发生的地方', () => {
    const problems: string[] = []
    for (const cat of CATS) {
      const collectors = collectorsOf(cat)
      if (collectors.length === 0) {
        problems.push(`${cat}: 找不到任何 collect 调用点 —— 这一类没有获取路径?`)
        continue
      }
      const known = collectors.filter(f => f in MODULE_KEYWORD)
      if (known.length === 0) {
        problems.push(`${cat}: 收录点 ${collectors.join('、')} 都不在已知机制表里,说明无从校准`)
        continue
      }
      const text = CODEX_SOURCES[cat]
      for (const file of known) {
        const keyword = MODULE_KEYWORD[file]!
        if (!text.includes(keyword)) {
          problems.push(`${cat}: 收录发生在 ${file},而说明里没提「${keyword}」——现在写的是「${text}」`)
        }
      }
    }
    expect(problems, problems.join('\n')).toEqual([])
  })

  it('反向也成立:说明里提到的机制,得有对应的收录点', () => {
    for (const cat of CATS) {
      const text = CODEX_SOURCES[cat]
      if (!text.includes('炼')) continue
      expect(
        collectorsOf(cat).includes('core/pillService.ts'),
        `${cat} 的说明说能炼出来,但没有任何炼丹收录点`
      ).toBe(true)
    }
  })
})
