/**
 * 全数据源图标键登记审计;装备另由 equipmentIcon.spec 守卫。
 * 渲染口 GameIcon → iconOf → ICONS,iconOf 有 Sparkles 兜底、永不抛错:键写错/被删只会静默掉成四角星。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { ICONS } from './icons'
import { EQUIPMENT_TEMPLATES } from '@/data/equipment'
import { BUILDINGS } from '@/data/buildings'
import { REGIONS } from '@/data/regions'
import { BUFFS } from '@/data/buffs'
import { PILLS } from '@/data/pills'
import { ARTIFACTS } from '@/data/artifacts'
import { CELESTIAL_WORLDS, TRIAL_FOES } from '@/data/endgame'

const SOURCES: { label: string; items: { name?: string; icon?: string }[] }[] = [
  { label: '装备', items: EQUIPMENT_TEMPLATES },
  // 敌人与灵兽不自持 icon:族类 → 形 唯一事实源 data/beastFamilies.ts,spec 钉:beastFamilies.spec.ts。
  { label: '建筑', items: BUILDINGS },
  { label: '区域', items: REGIONS },
  { label: '增益', items: BUFFS },
  { label: '丹药', items: PILLS },
  { label: '法宝', items: ARTIFACTS },
  // 除 foes 外,守界 guardian 与路线树每个节点的镇守 foe 同样是渲染口。
  {
    label: '天道各界的敌人',
    items: CELESTIAL_WORLDS.flatMap(w => [...w.foes, w.guardian, ...w.routes.flat().map(n => n.foe)])
  },
  { label: '试炼之敌', items: TRIAL_FOES }
]

describe('图标注册表 · 全数据源无死键', () => {
  it.each(SOURCES)('$label 的每个图标键都在 ICONS 注册表里', ({ label, items }) => {
    const dead = items
      .filter(item => item.icon !== undefined && !(item.icon! in ICONS))
      .map(item => `${item.name ?? '?'}:${item.icon}`)
    expect(dead, `${label} 以下图标键未注册(会静默掉成 Sparkles)`).toEqual([])
  })
})

const SRC = resolve(__dirname, '..')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|vue)$/.test(entry) && !entry.endsWith('.spec.ts')) out.push(full)
  }
  return out
}

/**
 * 按文本扫源码里写死的图标名(SOURCES 查不到界面现拼的名字),三种写法:
 * `icon: 'x'`(数据表与局部映射)、`<GameIcon … :name="… 'x' …"`(绑定表达式里的字面量)、`<GameIcon name="x"`(静态属性)。
 */
function literalIconNames(text: string): string[] {
  const names: string[] = []
  // 引号三种都要认:单引号、双引号、反引号;只认单引号会整段漏扫另两种写法。
  for (const m of text.matchAll(/\bicon:\s*['"`]([a-z0-9-]+)['"`]/g)) names.push(m[1]!)
  for (const m of text.matchAll(/<GameIcon\b[^>]*?:name="([^"]*)"/gs))
    for (const lit of m[1]!.matchAll(/'([a-z0-9-]+)'/g)) names.push(lit[1]!)
  for (const m of text.matchAll(/<GameIcon\b[^>]*?\bname="([a-z0-9-]+)"/g)) names.push(m[1]!)
  return names
}

describe('图标注册表 · 源码里写死的名字也必须登记', () => {
  it('三种写法扫出来的每个键都在 ICONS 里(漏登记就静默掉成四角星)', () => {
    const dead: string[] = []
    let scanned = 0
    for (const file of walk(SRC)) {
      const text = readFileSync(file, 'utf8')
      const names = literalIconNames(text)
      // 阳性对照
      scanned += names.length
      for (const name of names) if (!(name in ICONS)) dead.push(`${file.slice(SRC.length + 1)}:${name}`)
    }
    expect(scanned, '一处图标字面量都没扫到 —— 正则坏了,这条会在空集上假绿').toBeGreaterThan(100)
    expect([...new Set(dead)], '这些名字写在了源码里却没进 ICONS 注册表').toEqual([])
  })

  /** 故障注入:把 RegionCard 的 `'shield-check'` 改成没登记的键(如 `'shield-ok'`),或把 names 换回按对象字段查,本条红。 */
  it('判据自家不空转:RegionCard 那处三元里的字面量真被读到了', () => {
    const src = readFileSync(resolve(SRC, 'components/adventure/RegionCard.vue'), 'utf8')
    expect(literalIconNames(src), '表达式里嵌的图标名没被读出来').toContain('shield-check')
  })
})
