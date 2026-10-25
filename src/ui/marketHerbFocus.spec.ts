/**
 * 坊市续草落点(深链 focus=herb):切签回「购」只重算高亮不滚;每次进坊市、换过货(含离开购签期间)才滚。
 * node 环境按 SSR 编 SFC,且无 DOM 库:沿用真组件 setup,真模板按客户端重编,挂到假节点渲染器上数 scrollIntoView。
 * 故障注入:focusedStockAt 改回货架段内部状态、或宿主不绑 v-model,前三条红;删掉换货 watch,第三条红;
 * 落点记到模块级(跨宿主实例存活),第四条红。
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as Vue from 'vue'
import { createRenderer, defineComponent, ssrContextKey, type App, type Component, type RenderFunction, type RendererOptions } from 'vue'
import { compileScript, compileTemplate, parse, type BindingMetadata } from 'vue/compiler-sfc'
import ts from 'typescript'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import MarketView from '@/views/MarketView.vue'
import MarketShelfSection from '@/components/market/MarketShelfSection.vue'
import InkTabs from '@/components/common/InkTabs.vue'
import { useMarketStore } from '@/stores/market'
import { usePlayerStore } from '@/stores/player'
import { useResourcesStore } from '@/stores/resources'
import { herbGradeOfMajor, type HerbGrade } from '@/data/herbGrades'
import { MARKET_REFRESH_SECONDS, type MarketSlot } from '@/data/market'

interface FakeNode {
  tag: string
  text: string
  attrs: Record<string, unknown>
  children: FakeNode[]
  parent: FakeNode | null
  querySelector: (selector: string) => FakeNode | null
  scrollIntoView: (opts?: ScrollIntoViewOptions) => void
}

/** 每次 scrollIntoView 记一笔:`card#渲染序号:block` 或 `标签名:block` */
const scrolls: string[] = []

function findAll(node: FakeNode, hit: (n: FakeNode) => boolean, out: FakeNode[] = []): FakeNode[] {
  for (const c of node.children) {
    if (hit(c)) out.push(c)
    findAll(c, hit, out)
  }
  return out
}

function textOf(node: FakeNode): string {
  return node.tag === '#text' ? node.text : node.children.map(textOf).join('')
}

function makeNode(tag: string, text = ''): FakeNode {
  const node: FakeNode = {
    tag,
    text,
    attrs: {},
    children: [],
    parent: null,
    querySelector(selector) {
      // 落点只用 [data-card="N"]
      const m = /^\[([\w-]+)="([^"]*)"\]$/.exec(selector)
      if (!m) throw new Error(`假节点不支持选择器 ${selector}`)
      const key = m[1] ?? ''
      return findAll(node, n => n.attrs[key] !== undefined && String(n.attrs[key]) === m[2])[0] ?? null
    },
    scrollIntoView(opts) {
      const card = node.attrs['data-card']
      scrolls.push(`${card === undefined ? node.tag : `card#${String(card)}`}:${opts?.block ?? ''}`)
    }
  }
  return node
}

function detach(child: FakeNode): void {
  const siblings = child.parent?.children ?? []
  const at = siblings.indexOf(child)
  if (at >= 0) siblings.splice(at, 1)
  child.parent = null
}

const nodeOps: RendererOptions<FakeNode, FakeNode> = {
  patchProp(el, key, _prev, next) {
    el.attrs[key] = next
  },
  insert(child, parent, anchor) {
    detach(child)
    child.parent = parent
    const at = anchor ? parent.children.indexOf(anchor) : -1
    if (at >= 0) parent.children.splice(at, 0, child)
    else parent.children.push(child)
  },
  remove: detach,
  createElement: tag => makeNode(tag),
  createText: text => makeNode('#text', text),
  createComment: text => makeNode('#comment', text),
  setText(node, text) {
    node.text = text
  },
  setElementText(el, text) {
    for (const c of el.children) c.parent = null
    el.children = []
    if (text) nodeOps.insert(makeNode('#text', text), el, null)
  },
  parentNode: node => node.parent,
  nextSibling(node) {
    const siblings = node.parent?.children ?? []
    return siblings[siblings.indexOf(node) + 1] ?? null
  },
  insertStaticContent(content, parent, anchor) {
    const node = makeNode('#text', content)
    nodeOps.insert(node, parent, anchor)
    return [node, node]
  }
}
const { createApp } = createRenderer(nodeOps)

/** 与落点无关的子件,只占位 */
const Stub = defineComponent({ inheritAttrs: false, render: () => null })

/**
 * 真组件 setup + 按客户端重编的真模板。
 * script setup 的绑定只经 $setup 可见,模板须带 bindingMetadata 编;子件从绑定里摘掉,改走 components 解析。
 * 模板表达式可含 TS(如 `c.quality!`),编出的模块先经 typescript 转成 CJS 再求值。
 */
function clientOf(comp: Component, rel: string, components: Record<string, Component>): Component {
  const { descriptor } = parse(readFileSync(resolve(__dirname, '..', rel), 'utf8'), { filename: rel })
  if (!descriptor.template) throw new Error(`${rel} 缺模板`)
  const all: BindingMetadata = compileScript(descriptor, { id: rel }).bindings ?? {}
  const bindings = Object.fromEntries(Object.entries(all).filter(([name]) => !(name in components))) as BindingMetadata
  const { code, errors } = compileTemplate({
    source: descriptor.template.content,
    filename: rel,
    id: rel,
    compilerOptions: { bindingMetadata: bindings, expressionPlugins: ['typescript'] }
  })
  if (errors.length > 0) throw new Error(`${rel} 模板编译失败:${errors.map(String).join(';')}`)
  const js = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const exported: { render?: RenderFunction } = {}
  new Function('exports', 'require', js)(exported, (id: string) => (id === 'vue' ? Vue : undefined))
  if (!exported.render) throw new Error(`${rel} 未编出 render`)
  return { ...(comp as Record<string, unknown>), ssrRender: undefined, render: exported.render, components } as Component
}

/** 方子要的那品灵草摆在 at 号格,其余灵草改玄铁:落点恒为 card#at */
function withHerbAt(stock: readonly MarketSlot[], grade: HerbGrade, at: number): MarketSlot[] {
  return stock.map(s =>
    s.idx === at
      ? { kind: 'material', idx: at, matId: 'herb', grade, count: 5, price: { m: 1, e: 1 }, sold: false }
      : s.kind === 'material' && s.matId === 'herb'
        ? { ...s, matId: 'ore' }
        : s
  )
}

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i += 1) await new Promise(r => setTimeout(r, 0))
}

describe('坊市续草落点 · 切签与换货', () => {
  let view: Component
  let app: App<FakeNode> | null = null
  let root: FakeNode
  let pinia: Pinia
  let want: HerbGrade
  const errors: unknown[] = []

  beforeAll(() => {
    const shelf = clientOf(MarketShelfSection, 'components/market/MarketShelfSection.vue', {
      SectionTitle: Stub,
      GameIcon: Stub,
      QualitySeal: Stub
    })
    view = clientOf(MarketView, 'views/MarketView.vue', {
      InkTabs: clientOf(InkTabs, 'components/common/InkTabs.vue', {}),
      MarketShelfSection: shelf,
      MarketSellSection: Stub,
      BountyBoardSection: Stub,
      GameIcon: Stub
    })
  })

  /** 从丹炉深链进坊市:宿主新挂一份,Pinia 沿用 */
  async function enter(): Promise<void> {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/market', component: Stub }] })
    await router.push({ path: '/market', query: { focus: 'herb', grade: String(want) } })
    app = createApp(view)
    // SSR 编出的 setup 外壳要往 ssrContext 登记模块
    app.provide(ssrContextKey, { modules: new Set<string>() })
    app.config.errorHandler = err => {
      errors.push(err)
    }
    app.use(pinia)
    app.use(router)
    root = makeNode('#root')
    app.mount(root)
    await settle()
  }

  beforeEach(async () => {
    scrolls.length = 0
    errors.length = 0
    // 宿主每秒的轮询不跑;悬赏倒计时的墙钟读 window.setInterval
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    vi.stubGlobal('window', { setInterval: () => 0, clearInterval: () => undefined })
    pinia = createPinia()
    setActivePinia(pinia)
    want = herbGradeOfMajor(usePlayerStore().major)
    const market = useMarketStore()
    market.sync(Date.now())
    market.stock = withHerbAt(market.stock, want, 0)
    useResourcesStore().spiritStone = { m: 1, e: 30 }
    await enter()
  })

  afterEach(() => {
    app?.unmount()
    app = null
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  async function clickTab(label: string): Promise<void> {
    const tab = findAll(root, n => n.attrs.role === 'tab').find(n => textOf(n).trim() === label)
    if (!tab) throw new Error(`缺签「${label}」`)
    ;(tab.attrs.onClick as () => void)()
    await settle()
  }

  const highlighted = (): number[] =>
    findAll(root, n => n.attrs['data-card'] !== undefined && String(n.attrs.class).includes('ring-2')).map(n =>
      Number(n.attrs['data-card'])
    )

  const missingText = (): string | null => {
    const p = findAll(root, n => n.attrs['data-focus-herb-missing'] !== undefined)[0]
    return p ? textOf(p).trim() : null
  }

  /** 跨过刷新窗口重上一架,灵草摆到 at 号格 */
  async function restock(at: number): Promise<void> {
    const market = useMarketStore()
    market.sync(market.stockedAt + MARKET_REFRESH_SECONDS * 1000)
    market.stock = withHerbAt(market.stock, want, at)
    await settle()
  }

  it('首次进入滚一次;切签回购只重算高亮,不滚、不换货', async () => {
    expect(scrolls).toEqual(['card#0:center'])
    expect(highlighted()).toEqual([0])
    const stock = useMarketStore().stock

    await clickTab('售')
    expect(highlighted()).toEqual([])
    await clickTab('购')
    await clickTab('悬赏')
    await clickTab('购')
    expect(scrolls, '切签回购不该再滚').toEqual(['card#0:center'])
    expect(highlighted()).toEqual([0])
    expect(useMarketStore().stock, '切签不重上货').toBe(stock)
    expect(errors).toEqual([])
  })

  it('买空这品草后切签回购:只报售罄,不滚', async () => {
    const card0 = findAll(root, n => n.attrs['data-card'] === 0)[0]!
    const buy = findAll(card0, n => n.tag === 'button')[0]!
    ;(buy.attrs.onClick as () => void)()
    await settle()
    expect(useMarketStore().stock.find(s => s.idx === 0)?.sold).toBe(true)

    await clickTab('售')
    await clickTab('购')
    expect(scrolls).toEqual(['card#0:center'])
    expect(missingText()).toBe('此品灵草已售罄')
    expect(errors).toEqual([])
  })

  it('离开购签期间换过货,回购签重新落点;停在购签换货也重新落点;之后切签不再滚', async () => {
    await clickTab('售')
    await restock(2)
    await clickTab('购')
    expect(scrolls, '离开期间换货,回来要重新落点').toEqual(['card#0:center', 'card#2:center'])
    expect(highlighted()).toEqual([2])

    await restock(4)
    expect(scrolls, '停在购签换货要重新落点').toEqual(['card#0:center', 'card#2:center', 'card#4:center'])
    expect(highlighted()).toEqual([4])

    await clickTab('售')
    await clickTab('购')
    expect(scrolls, '换货后的落点已记下,切签不再滚').toHaveLength(3)
    expect(highlighted()).toEqual([4])
    expect(errors).toEqual([])
  })

  it('离开坊市再进:同一架货也重新落点', async () => {
    app?.unmount()
    await enter()
    expect(scrolls, '新进坊市要重新落点').toEqual(['card#0:center', 'card#0:center'])
    expect(highlighted()).toEqual([0])
    expect(errors).toEqual([])
  })
})
