/**
 * 旧版存档迁移:v1 单法宝位(`equippedArtifact`)→ v2 多法宝位(`equippedArtifacts`)。
 * 两个入口:启动时 `migrateLocalSchema` 就地升级本机分片,并把旧明文档转成密文;
 * 导入时 `save.ts` 的 migrate 按 version 链式升级。
 * 故障注入:让 migrateInventorySlice 丢掉旧值(或保留 equippedArtifact),第一条红;
 * 去掉 migrateLocalSchema 里的 encryptSave,密文那条红。
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { createApp } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import {
  clearAllSave,
  dropPendingWrites,
  migrateInventorySlice,
  migrateLocalSchema,
  storageKey
} from '@/utils/storage'
import { decryptSave, encryptSave } from '@/utils/crypto'
import { importSaveText } from './save'
import { useInventoryStore } from '@/stores/inventory'
import { useGameStore } from '@/stores/game'
import { usePlayerStore } from '@/stores/player'

function installStorage(): Map<string, string> {
  const disk = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => disk.get(k) ?? null,
    setItem: (k: string, v: string) => void disk.set(k, v),
    removeItem: (k: string) => void disk.delete(k),
    clear: () => disk.clear(),
    key: () => null,
    length: 0
  })
  return disk
}

function bootStores(): void {
  const pinia = createPinia()
  pinia.use(piniaPluginPersistedstate)
  createApp({ render: () => null }).use(pinia)
  setActivePinia(pinia)
}

const LEGACY_V1 = {
  items: [{ uid: 'u1', templateId: 'w_zhuqing', quality: 'fine', tier: 1, level: 0, affixes: [] }],
  equipped: { weapon: 'u1' },
  pills: {},
  artifacts: [{ defId: 'af_youming', level: 2 }],
  equippedArtifact: 'af_youming'
}

describe('迁移 · v1 单法宝位 → v2 多法宝位', () => {
  it('旧值搬进新字段,旧字段清掉', () => {
    const next = migrateInventorySlice(structuredClone(LEGACY_V1))
    expect(next.equippedArtifacts, '旧法宝没搬过来 —— 玩家的法宝位会空着').toEqual(['af_youming'])
    expect('equippedArtifact' in next, '旧字段留在档里,会反复参与后续迁移').toBe(false)
    expect(next.items, '其它字段不该被动').toEqual(LEGACY_V1.items)
  })

  it('已经是新形状的原样返回(幂等)', () => {
    const v2 = { equippedArtifacts: ['af_a', 'af_b'], items: [] }
    const first = migrateInventorySlice(structuredClone(v2))
    expect(first).toEqual(v2)
    expect(migrateInventorySlice(structuredClone(first)), '跑第二遍不该变样').toEqual(v2)
  })

  it('旧字段是空串/垃圾时,新字段该是空数组而不是垃圾', () => {
    expect(migrateInventorySlice({ equippedArtifact: '' }).equippedArtifacts).toEqual([])
    expect(migrateInventorySlice({ equippedArtifact: 42 }).equippedArtifacts).toEqual([])
    expect(migrateInventorySlice({}).equippedArtifacts).toEqual([])
  })
})

describe('迁移 · 启动时就地升级本机分片', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    installStorage()
    dropPendingWrites()
    clearAllSave()
  })

  it('旧明文档被升级并转成密文', () => {
    localStorage.setItem(storageKey('inventory'), JSON.stringify(LEGACY_V1))
    migrateLocalSchema()
    const raw = localStorage.getItem(storageKey('inventory'))!
    expect(raw, '迁移后的分片必须落密文').not.toContain('af_youming')
    const back = JSON.parse(decryptSave(raw)!)
    expect(back.equippedArtifacts).toEqual(['af_youming'])
    expect('equippedArtifact' in back).toBe(false)
  })

  it('分片是垃圾时不动它、也不抛(交由损坏扫描兜底)', () => {
    localStorage.setItem(storageKey('inventory'), '这不是 JSON')
    expect(() => migrateLocalSchema()).not.toThrow()
    expect(localStorage.getItem(storageKey('inventory'))).toBe('这不是 JSON')
  })

  it('其它分片还是明文的老档,也读得出来(迁移只碰 inventory,但读取要认明文)', () => {
    // v1 档分片全是明文;迁移只把 inventory 转密文,其余靠 readSaveText 的明文回退读回
    // (明文被误当密文会解出乱码)
    localStorage.setItem(storageKey('player'), JSON.stringify({ major: 6, age: 300 }))
    localStorage.setItem(storageKey('inventory'), JSON.stringify(LEGACY_V1))
    migrateLocalSchema()
    bootStores()
    expect(usePlayerStore().major, '明文 player 分片没读回来').toBe(6)
    expect(useInventoryStore().equippedArtifacts).toEqual(['af_youming'])
  })

  it('已是新档的分片不再重写:迁移 no-op 时不重复加密落盘(不再白付 AES/parse)', () => {
    // 无旧字段时 migrateLocalSchema 不得回写分片:密文含随机盐,重加密必变字节
    const inv = { equippedArtifacts: ['af_youming'] }
    const res = { herbByGrade: { 1: 0, 2: 0, 3: 5, 4: 0, 5: 0 }, ore: 1 }
    localStorage.setItem(storageKey('inventory'), encryptSave(JSON.stringify(inv)))
    localStorage.setItem(storageKey('resources'), encryptSave(JSON.stringify(res)))
    const invBefore = localStorage.getItem(storageKey('inventory'))!
    const resBefore = localStorage.getItem(storageKey('resources'))!
    migrateLocalSchema()
    expect(localStorage.getItem(storageKey('inventory'))).toBe(invBefore)
    expect(localStorage.getItem(storageKey('resources'))).toBe(resBefore)
  })
})

describe('迁移 · 导入一份 v1 存档', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    installStorage()
    dropPendingWrites()
    clearAllSave()
  })

  it('导得进来,法宝位有东西,旧字段不残留', () => {
    const payload = {
      game: 'yunyin-xiuxian',
      version: 1,
      exportedAt: Date.now(),
      data: { game: { started: true }, player: { major: 3 }, inventory: structuredClone(LEGACY_V1) }
    }
    expect(importSaveText(JSON.stringify(payload)), 'v1 存档应当能导入').toBeNull()

    const raw = localStorage.getItem(storageKey('inventory'))!
    const stored = JSON.parse(decryptSave(raw)!)
    expect(stored.equippedArtifacts, '导入后旧法宝位没搬过来').toEqual(['af_youming'])
    expect('equippedArtifact' in stored).toBe(false)

    bootStores()
    const inventory = useInventoryStore()
    const game = useGameStore()
    expect(inventory.artifacts.map(a => a.defId)).toEqual(['af_youming'])
    expect(inventory.$state, '旧字段不该出现在运行时状态里').not.toHaveProperty('equippedArtifact')
    expect(game.started, '导入后应当已开局').toBe(true)
  })
})

describe('迁移 · 灵草五品(旧档单标量 herb → 品阶分账)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    installStorage()
    dropPendingWrites()
    clearAllSave()
  })

  it('启动迁移:resources 分片旧 scalar 统一落凡品账,清掉、不丢草', () => {
    // 20 境玩家 40 株旧草 → 全部并入凡品账,不随境界折算
    localStorage.setItem(storageKey('player'), JSON.stringify({ major: 20 }))
    localStorage.setItem(storageKey('resources'), JSON.stringify({ herb: 40, wudao: 5 }))
    migrateLocalSchema()
    const raw = localStorage.getItem(storageKey('resources'))!
    const back = JSON.parse(decryptSave(raw)!)
    expect(back.herbByGrade).toEqual({ 1: 40, 2: 0, 3: 0, 4: 0, 5: 0 })
    expect('herb' in back, '旧标量字段必须清掉,否则反复折算').toBe(false)
    expect(back.wudao, '其它资源字段不该被动').toBe(5)
  })

  it('灵品境(5)玩家:旧草统一并入凡品账,不丢草', () => {
    localStorage.setItem(storageKey('player'), JSON.stringify({ major: 5 }))
    localStorage.setItem(storageKey('resources'), JSON.stringify({ herb: 12 }))
    migrateLocalSchema()
    const back = JSON.parse(decryptSave(localStorage.getItem(storageKey('resources'))!)!)
    expect(back.herbByGrade[1], '旧草并入凡品账').toBe(12)
  })

  it('导入路径同样归一 resources 分片旧草到凡品账(不丢草)', () => {
    const payload = {
      game: 'yunyin-xiuxian',
      version: 2,
      exportedAt: Date.now(),
      data: { game: { started: true }, player: { major: 9 }, resources: { herb: 60 } }
    }
    expect(importSaveText(JSON.stringify(payload))).toBeNull()
    const back = JSON.parse(decryptSave(localStorage.getItem(storageKey('resources'))!)!)
    expect(back.herbByGrade[1], '仙界(9 境)旧草同样并入凡品账').toBe(60)
    expect('herb' in back).toBe(false)
  })
})
