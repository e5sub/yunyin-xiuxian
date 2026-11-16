/**
 * PC 版侧栏的入口清单。
 *
 * 移动端靠底栏五页 + 首页宫格分流;PC 版把底栏换成左栏,宫格那十几个入口也就没了去处 ——
 * 若沿用手点宫格的路子,PC 玩家每去一次坊市都要先回首页。故这里一次列全:
 * 除欢迎页 / 建号页 / 登录页(那三页没有外壳)之外的每条路由都在此出现一次。
 *
 * 判据见 src/ui/desktopShell.spec.ts:路由表里的每条 path 必须在这里有且只有一条对应项,
 * 图标必须在 src/ui/icons.ts 注册,标签 2~4 个汉字(AGENTS.md 的按钮文案上限)。
 */
export interface DesktopNavItem {
  /** 路由名,用来判当前页(与 router 的 name 一致) */
  readonly name: string
  readonly label: string
  readonly icon: string
  readonly to: string
  /** 门槛:未破界(飞升天界)前不出现,免得点了被守卫弹回 */
  readonly needWorldBreak?: true
}

export interface DesktopNavGroup {
  readonly title: string
  readonly items: readonly DesktopNavItem[]
}

export const DESKTOP_NAV: readonly DesktopNavGroup[] = [
  {
    title: '修行',
    items: [
      { name: 'home', label: '洞府', icon: 'mountain', to: '/' },
      { name: 'cultivation', label: '修炼', icon: 'flame', to: '/cultivation' },
      { name: 'adventure', label: '历练', icon: 'swords', to: '/adventure' },
      { name: 'inventory', label: '背包', icon: 'backpack', to: '/inventory' },
      { name: 'character', label: '人物', icon: 'circle-user', to: '/character' }
    ]
  },
  {
    title: '身外',
    items: [
      { name: 'dongfu', label: '洞府营造', icon: 'home', to: '/dongfu' },
      { name: 'market', label: '坊市', icon: 'store', to: '/market' },
      { name: 'sect', label: '门派', icon: 'landmark', to: '/sect' },
      { name: 'apprentice', label: '道童', icon: 'sprout', to: '/apprentice' },
      { name: 'souls', label: '器魂', icon: 'gem', to: '/souls' },
      { name: 'collection', label: '成就', icon: 'badge', to: '/collection' },
      { name: 'titles', label: '名号', icon: 'stamp', to: '/titles' },
      { name: 'build', label: '流派', icon: 'compass', to: '/build' }
    ]
  },
  {
    title: '江湖',
    items: [
      { name: 'world', label: '本世之界', icon: 'cloud', to: '/world' },
      { name: 'celestial', label: '天界', icon: 'sparkles', to: '/celestial', needWorldBreak: true },
      { name: 'event', label: '周天七会', icon: 'orbit', to: '/event' },
      { name: 'boss', label: '围妖', icon: 'skull', to: '/boss' },
      { name: 'dungeon', label: '秘境', icon: 'ghost', to: '/dungeon' },
      { name: 'friends', label: '道友', icon: 'users', to: '/friends' },
      { name: 'leisure', label: '闲趣', icon: 'moon', to: '/leisure' }
    ]
  },
  {
    title: '杂录',
    items: [
      { name: 'codex', label: '界域志', icon: 'book', to: '/codex' },
      { name: 'legacy', label: '修仙录', icon: 'scroll', to: '/legacy' },
      { name: 'settings', label: '设置', icon: 'settings', to: '/settings' }
    ]
  }
]
