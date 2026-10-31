import { createRouter, createWebHashHistory } from 'vue-router'
import { useGameStore } from '@/stores/game'
import { useSettingsStore } from '@/stores/settings'
import { useAuthStore } from '@/stores/auth'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/login', name: 'login', component: () => import('@/views/LoginView.vue') },
    { path: '/welcome', name: 'welcome', component: () => import('@/views/WelcomeView.vue') },
    { path: '/create', name: 'create', component: () => import('@/views/CreateView.vue') },
    { path: '/', name: 'home', component: () => import('@/views/HomeView.vue') },
    { path: '/cultivation', name: 'cultivation', component: () => import('@/views/CultivationView.vue') },
    { path: '/codex', name: 'codex', component: () => import('@/views/RealmCodexView.vue') },
    { path: '/adventure', name: 'adventure', component: () => import('@/views/AdventureView.vue') },
    { path: '/world', name: 'world', component: () => import('@/views/MortalWorldView.vue') },
    { path: '/inventory', name: 'inventory', component: () => import('@/views/InventoryView.vue') },
    { path: '/character', name: 'character', component: () => import('@/views/CharacterView.vue') },
    { path: '/celestial', name: 'celestial', component: () => import('@/views/CelestialView.vue') },
    { path: '/souls', name: 'souls', component: () => import('@/views/SoulsView.vue') },
    { path: '/dongfu', name: 'dongfu', component: () => import('@/views/DongfuView.vue') },
    { path: '/collection', name: 'collection', component: () => import('@/views/CollectionView.vue') },
    { path: '/build', name: 'build', component: () => import('@/views/BuildView.vue') },
    { path: '/market', name: 'market', component: () => import('@/views/MarketView.vue') },
    { path: '/apprentice', name: 'apprentice', component: () => import('@/views/ApprenticeView.vue') },
    { path: '/titles', name: 'titles', component: () => import('@/views/TitlesView.vue') },
    { path: '/legacy', name: 'legacy', component: () => import('@/views/LegacyView.vue') },
    { path: '/settings', name: 'settings', component: () => import('@/views/SettingsView.vue') },
    { path: '/friends', name: 'friends', component: () => import('@/views/FriendsView.vue') },
    { path: '/boss', name: 'boss', component: () => import('@/views/BossView.vue') },
    { path: '/event', name: 'event', component: () => import('@/views/EventView.vue') },
    { path: '/dungeon', name: 'dungeon', component: () => import('@/views/DungeonView.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' }
  ]
})

router.beforeEach(to => {
  // 未登录一律先到登录页(网游版:进度存云端,不再有游客模式)
  const auth = useAuthStore()
  if (!auth.loggedIn) {
    return to.name === 'login' ? true : { name: 'login' }
  }
  const game = useGameStore()
  if (game.started) {
    // 已开局还停在 welcome/create/login 都是异常态:云端档应用后会 reload,URL 可能仍是登录页
    if (to.name === 'welcome' || to.name === 'create' || to.name === 'login') return { name: 'home' }
    return true
  }
  const settings = useSettingsStore()
  if (to.name === 'welcome') return true
  if (to.name === 'create') return settings.privacyAccepted ? true : { name: 'welcome' }
  return { name: 'welcome' }
})
