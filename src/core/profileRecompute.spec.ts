/**
 * 服务端复算快照的可信度:属性只认「从存档分片重推」,不认存档里躺着的任何属性字段。
 * 服务端(save.ts)对失败回落有兜底,这里钉的是复算本体:
 *   一、分片水合后的复算 = 客户端同刻直取 store 的快照(同一条 finalStats 链,两端口径一致);
 *   二、往分片里塞 attack: 1e999 这类属性字段,复算结果纹丝不动 —— 改档改不动属性;
 *   三、畸形分片(major 不可读)返回 null,调用方回落,绝不编数。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { usePlayerStore } from '@/stores/player'
import { useInventoryStore } from '@/stores/inventory'
import { useCultivationStore } from '@/stores/cultivation'
import { useDongfuStore } from '@/stores/dongfu'
import { useResourcesStore } from '@/stores/resources'
import { snapshotFromActiveStores, snapshotFromSlices } from './profileRecompute'

/** 五个参与复算的分片按当前 store 状态取平(与 persist 落盘同形:$state 即分片) */
function currentSlices(): Record<string, unknown> {
  return {
    player: usePlayerStore().$state,
    inventory: useInventoryStore().$state,
    cultivation: useCultivationStore().$state,
    dongfu: useDongfuStore().$state,
    resources: useResourcesStore().$state
  }
}

describe('档案快照复算 · 属性只认重推,不认存档自述', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('分片水合复算与客户端直取 store 同刻同值(两端口径一致)', () => {
    const player = usePlayerStore()
    player.$patch({ major: 6, sub: 2, name: '试剑者' })
    const live = snapshotFromActiveStores()
    expect(live).not.toBeNull()
    // $state 是响应式代理,深拷成纯 JSON 才与上传链路同形
    const slices = JSON.parse(JSON.stringify(currentSlices())) as Record<string, unknown>
    const rehydrated = snapshotFromSlices(slices)
    expect(rehydrated).toEqual(live)
    // 合法终局前的中间态:数值必须是有限值
    expect(live!.hpE).toBeLessThan(150)
    expect(live!.atkE).toBeLessThan(150)
  })

  it('分片里塞属性字段改不动快照:复算只认装备/功法/境界等事实分片', () => {
    const player = usePlayerStore()
    player.$patch({ major: 4, sub: 5, name: '改档侠' })
    const slices = JSON.parse(JSON.stringify(currentSlices())) as Record<string, unknown>
    const honest = snapshotFromSlices(slices)
    expect(honest).not.toBeNull()
    // 作弊者往存档里塞天数字段(无论叫什么名),复算结果必须一字不变
    const playerSlice = slices.player as Record<string, unknown>
    playerSlice.attack = { m: 9.99, e: 149 }
    playerSlice.hp = { m: 9.99, e: 149 }
    playerSlice.power = { m: 9.99, e: 149 }
    playerSlice.atkM = 9.99
    playerSlice.atkE = 149
    const cheated = snapshotFromSlices(slices)
    expect(cheated).toEqual(honest)
  })

  it('畸形分片(major 不可读)返回 null,绝不编数', () => {
    expect(snapshotFromSlices({ player: { major: '无所谓' } })).toBeNull()
    expect(snapshotFromSlices(null)).toBeNull()
    expect(snapshotFromSlices('乱串')).toBeNull()
  })
})
