/**
 * PC 布局的门禁。
 *
 * 这里钉三件事,都是「改坏了不报错、只是悄悄变难看」的那类:
 *
 * 一 **字号台账两侧一致**。移动端字号是 px 手写的(`text-[11px]`),不吃 html 的 font-size,
 *    PC 上的字只能靠 style.css 里那张逐档放大的表。表与源码各写各的,谁都会漏:
 *    新写一个 `text-[12.5px]` 不会有任何提示,PC 上就那一处还是小字。
 *    故反向也查 —— 源码里每个 ≤16px 的档位,表里必须有一条对应规则。
 *
 * 二 **断点同档**。PC 样式块的 1024 与 Tailwind 的 lg 是同一个屏幕宽度:
 *    差一档就会出现「左栏已经出来了、页面还在走移动端栅格」的中间态。
 *
 * 三 **侧栏不漏页**。移动端靠底栏五页 + 首页宫格分流;PC 版没有宫格,
 *    路由表里每条 page 都必须在侧栏有且仅有一条入口,否则 PC 上那页根本进不去。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DESKTOP_NAV } from './desktopNav'

const ROOT = resolve(__dirname, '..', '..')
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf-8')

/** PC 断点:与 tailwind.config 的 lg(1024)同档 */
const DESKTOP_MIN_WIDTH = 1024

function walk(dir: string): string[] {
  const out: string[] = []
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name)
    if (ent.isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

/** style.css 里那段 PC 样式块(从「PC 布局」标题到文件末尾) */
function pcBlock(): string {
  const css = read('src/style.css')
  const start = css.indexOf('PC 布局（≥')
  expect(start, 'style.css 里找不到「PC 布局」一节').toBeGreaterThan(-1)
  return css.slice(start)
}

describe('PC 布局 · 字号表', () => {
  it('given style.css 的 PC 样式块, when 读断点, then 与 Tailwind 的 lg 同为 1024', () => {
    expect(pcBlock()).toContain(`@media (min-width: ${DESKTOP_MIN_WIDTH}px)`)
    // lg 直接在样式的媒体查询里写死;config 里若覆写 screens,两边就会错开
    expect(read('tailwind.config.js')).not.toMatch(/^\s*screens:/m)
  })

  it('given PC 字号表, when 逐档对照, then 每档都放大,且 13px 以下至少 +2', () => {
    const rules = [...pcBlock().matchAll(/\.text-\\\[(\d+)px\\\]\s*\{\s*font-size:\s*(\d+)px;/g)]
    expect(rules.length, 'PC 字号表一条规则都没解析出来').toBeGreaterThan(0)
    for (const [, from, to] of rules) {
      const mobile = Number(from)
      const desktop = Number(to)
      expect(desktop, `${mobile}px 在 PC 上没有放大`).toBeGreaterThan(mobile)
      if (mobile <= 13) expect(desktop - mobile, `${mobile}px 在 PC 上只大了 ${desktop - mobile}px`).toBeGreaterThanOrEqual(2)
    }
  })

  it('given 源码里用到的每个 ≤16px 字号, when 查 PC 字号表, then 都有对应规则', () => {
    const covered = new Set(
      [...pcBlock().matchAll(/\.text-\\\[(\d+)px\\\]\s*\{\s*font-size:/g)].map(m => Number(m[1]))
    )
    const used = new Map<number, string>()
    for (const file of walk(join(ROOT, 'src'))) {
      if (!/\.(vue|ts)$/.test(file) || file.endsWith('.spec.ts')) continue
      for (const [, size] of readFileSync(file, 'utf-8').matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)) {
        const n = Number(size)
        if (n > 16) continue
        if (!used.has(n)) used.set(n, file.slice(ROOT.length + 1).replace(/\\/g, '/'))
      }
    }
    expect(used.size).toBeGreaterThan(0)
    const missing = [...used.entries()].filter(([size]) => !covered.has(size)).map(([size, file]) => `${size}px(首见 ${file})`)
    expect(missing, '这些字号在 PC 上没有放大规则').toEqual([])
  })

  it('given PC 样式块, when 找外壳加宽, then 有 flex-row 与 1240 上限', () => {
    const block = pcBlock()
    expect(block).toMatch(/\.app-shell\.app-shell-chrome\s*\{[^}]*flex-direction:\s*row/)
    expect(block).toMatch(/\.app-shell\.app-shell-chrome\s*\{[^}]*max-width:\s*1240px/)
    // 正文上限:否则 1240 的长句一路铺到底
    expect(block).toMatch(/main\s*>\s*\.stagger-in\s*\{[^}]*max-width:/)
  })
})

describe('PC 布局 · 侧栏', () => {
  /** router 源里的 path / name 配对 */
  function routes(): Map<string, string> {
    const src = read('src/router/index.ts')
    const out = new Map<string, string>()
    for (const m of src.matchAll(/path:\s*'([^']+)',\s*name:\s*'([^']+)'/g)) {
      const path = m[1]
      const name = m[2]
      if (path !== undefined && name !== undefined) out.set(path, name)
    }
    expect(out.size, 'router 里一条路由都没解析出来').toBeGreaterThan(20)
    return out
  }

  const items = DESKTOP_NAV.flatMap(group => group.items)

  it('given 路由表, when 查侧栏, then 除登录 / 欢迎 / 建号外每页都有入口', () => {
    const byPath = routes()
    const inNav = new Set(items.map(i => i.to))
    const missing = [...byPath.entries()]
      .filter(([, name]) => !['login', 'welcome', 'create'].includes(name))
      .filter(([path]) => !inNav.has(path))
      .map(([path, name]) => `${path}(${name})`)
    expect(missing, '这些页在 PC 侧栏里没有入口').toEqual([])
  })

  it('given 侧栏条目, when 对照路由表, then 路径与路由名都对得上且不重复', () => {
    const byPath = routes()
    const seen = new Set<string>()
    for (const item of items) {
      expect(byPath.get(item.to), `${item.to} 不是一条真实路由`).toBe(item.name)
      expect(seen.has(item.to), `${item.to} 在侧栏出现两次`).toBe(false)
      seen.add(item.to)
    }
  })

  it('given 底栏五页, when 查侧栏, then 五页都在(PC 上它们是主玩法入口)', () => {
    const nav = read('src/components/common/BottomNavigation.vue')
    const names = [...nav.matchAll(/name:\s*'([a-z-]+)'/g)].map(m => m[1] ?? '')
    expect(names.length, '底栏条目没解析出来').toBe(5)
    const inNav = new Set(items.map(i => i.name))
    expect(names.filter(n => !inNav.has(n)), '底栏的页没有进 PC 侧栏').toEqual([])
  })

  it('given 侧栏条目, when 查图标与文案, then 图标已注册、标签 2~4 字', () => {
    const icons = read('src/ui/icons.ts')
    const block = icons.slice(icons.indexOf('export const ICONS'))
    const registered = new Set([...block.matchAll(/^\s+'?([a-z0-9-]+)'?:\s*[A-Z]/gm)].map(m => m[1]))
    expect(registered.size, '图标表没解析出来').toBeGreaterThan(40)
    for (const item of items) {
      expect(registered.has(item.icon), `${item.label} 的图标 ${item.icon} 未注册`).toBe(true)
      expect(item.label.length, `${item.label} 不是 2~4 字`).toBeGreaterThanOrEqual(2)
      expect(item.label.length, `${item.label} 不是 2~4 字`).toBeLessThanOrEqual(4)
    }
  })

  it('given 天界门槛, when 未破界, then 该条目标了 needWorldBreak', () => {
    const celestial = items.find(i => i.name === 'celestial')
    expect(celestial?.needWorldBreak, '天界未标门槛,未飞升的档会点进去被弹回').toBe(true)
  })

  it('given App.vue, when 查两处导航, then 左栏在壳内、底栏只在窄屏', () => {
    const app = read('src/App.vue')
    expect(app).toContain('<SideNavigation v-if="showChrome" />')
    expect(app).toMatch(/<BottomNavigation v-if="showChrome" class="lg:hidden" \/>/)
    expect(app).toContain("'app-shell-chrome'")
  })
})
