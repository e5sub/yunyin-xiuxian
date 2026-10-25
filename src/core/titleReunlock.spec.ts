/**
 * 清档重修后境界称号可再解锁。
 * 链路:progress.trackRealm → unlockAchievement → grantReward → quests.ownTitle;
 * 成就与称号随 clearAllSave 清空(utils/storage 的 PERSISTED_STORES)。
 * 清档走真持久化回路;换空 pinia 测不到 clearAllSave 本身坏了。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createApp, nextTick } from 'vue'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import { usePlayerStore } from '@/stores/player'
import { useQuestsStore } from '@/stores/quests'
import { trackRealm } from './progress'
import { clearAllSave, flushSaveWrites, storageKey, PERSISTED_STORES } from '@/utils/storage'

/** 内存 localStorage */
function installStorage(): void {
  const disk = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => disk.get(k) ?? null,
    setItem: (k: string, v: string) => void disk.set(k, v),
    removeItem: (k: string) => void disk.delete(k),
    clear: () => disk.clear(),
    key: () => null,
    length: 0
  })
}

/** 真 pinia + 真持久化插件 */
function bootStores(): void {
  const pinia = createPinia()
  pinia.use(piniaPluginPersistedstate)
  createApp({ render: () => null }).use(pinia)
  setActivePinia(pinia)
}

function reachHuashen(major = 4): void {
  const player = usePlayerStore()
  player.major = major
  trackRealm()
}

describe('境界称号 · 清档重修可再解锁', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('首轮到化神:达成成就并获得 ti_huashen', () => {
    reachHuashen()
    const quests = useQuestsStore()
    expect(quests.hasAchieved('a_r4')).toBe(true)
    expect(quests.titlesOwned).toContain('ti_huashen')
  })

  it('真·清档重修:解锁落盘 → 清空 → 从磁盘重建 → 再解锁', async () => {
    installStorage()
    bootStores()
    reachHuashen()
    // 持久化订阅走 Vue 调度器(微任务),须等一拍才进待写队列
    await nextTick()
    flushSaveWrites()

    // 清档前须已落盘,否则下面清档空转
    expect(useQuestsStore().titlesOwned).toContain('ti_huashen')
    const questsKey = storageKey('quests')
    expect(localStorage.getItem(questsKey), '清档前成就该已落盘').not.toBeNull()

    clearAllSave()
    expect(
      PERSISTED_STORES.filter(id => localStorage.getItem(storageKey(id)) !== null),
      '清档要真把每片都删干净'
    ).toEqual([])

    // 从干净磁盘重建
    bootStores()
    const player = usePlayerStore()
    const quests = useQuestsStore()
    expect(player.major, '新档应从零开始').toBe(0)
    expect(quests.hasAchieved('a_r4'), '清档后成就不应在内').toBe(false)
    expect(quests.titlesOwned, '清档后称号不应残留').not.toContain('ti_huashen')

    reachHuashen()
    expect(quests.hasAchieved('a_r4'), '重修后成就要能再次达成').toBe(true)
    expect(quests.titlesOwned, '重修后称号要能再次入手').toContain('ti_huashen')
  })

  it('同一世重复触发不重复发放(成就保持已达成)', () => {
    reachHuashen()
    const quests = useQuestsStore()
    const countBefore = quests.titlesOwned.filter(t => t === 'ti_huashen').length
    reachHuashen()
    const countAfter = quests.titlesOwned.filter(t => t === 'ti_huashen').length
    expect(countAfter).toBe(countBefore)
    expect(quests.titlesOwned.filter(t => t === 'ti_huashen').length).toBe(1)
  })
})
