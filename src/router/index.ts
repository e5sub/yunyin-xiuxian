import { createRouter, createWebHashHistory } from 'vue-router'
import { useGameStore } from '@/stores/game'
import { useSettingsStore } from '@/stores/settings'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
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
    { path: '/:pathMatch(.*)*', redirect: '/' }
  ]
})

router.beforeEach(to => {
  const game = useGameStore()
  if (game.started) {
    if (to.name === 'welcome' || to.name === 'create') return { name: 'home' }
    return true
  }
  const settings = useSettingsStore()
  if (to.name === 'welcome') return true
  if (to.name === 'create') return settings.privacyAccepted ? true : { name: 'welcome' }
  return { name: 'welcome' }
})
