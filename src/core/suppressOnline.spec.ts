/* eslint-disable no-console */
import { describe, expect, it, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { usePlayerStore } from '@/stores/player'
import { useResourcesStore } from '@/stores/resources'
import { useDongfuStore } from '@/stores/dongfu'
import { settleSuppressedRegions } from './suppress'

describe('玩家反馈: 镇压后在线产出(真实场景)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('真实场景: 玩家镇压多个不同层级区域, 在线产出总量', () => {
    const player = usePlayerStore()
    const resources = useResourcesStore()

    // tier1 青云、tier10 剑冢、tier20 鸿蒙
    player.suppressedRegions = ['qingyun', 'jianzhong', 'hongmeng']

    const before = { ...resources.spiritStone }
    settleSuppressedRegions(3600) // 在线 1 小时

    const gained = resources.spiritStone.m * Math.pow(10, resources.spiritStone.e) - (before.m * Math.pow(10, before.e))
    console.log(`\n镇压 3 区域(不同层级)在线 1 小时:`)
    console.log(`  灵石: +${gained.toFixed(2)}`)

    const byTier = player.suppressedRegions.map(r => [r, r === 'qingyun' ? 'T1' : r === 'jianzhong' ? 'T10' : 'T20'])
    console.log(`  区域: ${JSON.stringify(byTier)}`)

    expect(gained).toBeGreaterThan(0)
  })

  it('真实场景: 镇压后在线 10 分钟的最小产出', () => {
    const player = usePlayerStore()
    const resources = useResourcesStore()
    player.suppressedRegions = ['qingyun']

    const before = { ...resources.spiritStone }
    settleSuppressedRegions(600) // 在线 10 分钟

    const gained = resources.spiritStone.m * Math.pow(10, resources.spiritStone.e) - (before.m * Math.pow(10, before.e))
    console.log(`\n镇压 1 区域在线 10 分钟: 灵石 +${gained.toFixed(2)}`)
    expect(gained).toBeGreaterThan(0)
  })

  it('验证: 灵脉投资是否影响镇压产出', () => {
    const player = usePlayerStore()
    const resources = useResourcesStore()
    const dongfu = useDongfuStore()
    player.suppressedRegions = ['qingyun']

    dongfu.veinPoints = { gather: 30, craft: 0, alchemy: 0, insight: 0 }

    const before = { ...resources.spiritStone }
    settleSuppressedRegions(3600)

    const gained = resources.spiritStone.m * Math.pow(10, resources.spiritStone.e) - (before.m * Math.pow(10, before.e))
    console.log(`\n镇压 + 灵脉 30 点在线 1 小时: 灵石 +${gained.toFixed(2)}`)
  })
})
