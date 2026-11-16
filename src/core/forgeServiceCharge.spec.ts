/**
 * 在线炼器 · 料耗落账:服务端裁定「该付多少」,客户端必须按这个数实扣。
 *
 * 1.58.3 把掷点与改件收进服务端后,客户端只 applyItems、不再跑纯账层 —— 纯账层里那三行
 * `spendStone / spendSmall('dust') / spendExp` 也跟着没了。服务端只记 forge_spend,
 * 上传时从「资源可增长量」里压回:那条线是 `上次值 + max(产速×4, 上限×30%)`,
 * 正常玩家余额远在其下,压回一次都不触发 —— 线上强化等于免费。这组判据钉住:
 * 每次成功结算都把回传的 spend 扣到本地三样上;被拒则一样不动。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { EquipmentInstance } from '@/types'
import { gn, subClamp, toNum } from '@/utils/gnum'
import { useAuthStore } from '@/stores/auth'
import { useInventoryStore } from '@/stores/inventory'
import { usePlayerStore } from '@/stores/player'
import { useResourcesStore } from '@/stores/resources'
import { requestReforge, requestUpgrade, requestTransfer, upgradeEquipmentBatch } from './forgeService'

const { forgeOp } = vi.hoisted(() => ({ forgeOp: vi.fn() }))

vi.mock('@/services/cloud', () => ({ cloudApi: { forgeOp } }))
// 展示层音效在无窗环境没有 Audio:只留空实现
vi.mock('./audio', () => ({ playSfx: () => {} }))
/*
 * 簿记打桩:强化会推进「累计强化 N 次」这类任务/成就,达成时 grantReward 会加灵石
 * (实测 45.6),把扣款断言搅成净值。这里只测扣款,簿记另有 spec 守。
 */
vi.mock('./forge', async importOriginal => {
  const actual = await importOriginal<typeof import('./forge')>()
  return { ...actual, noteUpgrade: () => {} }
})
vi.mock('./reforge', async importOriginal => {
  const actual = await importOriginal<typeof import('./reforge')>()
  return { ...actual, noteReforge: () => {} }
})

const UID = 'u_test_charge'

function mk(level = 0): EquipmentInstance {
  return { uid: UID, templateId: 'b_qingyun', quality: 'mortal', tier: 3, level, affixes: [] }
}

/** 登录态 + 一件凡品 + 三样都够 */
function seat(balance = { stone: 1e9, dust: 5000, exp: 1e9 }): void {
  setActivePinia(createPinia())
  useAuthStore().$patch({ token: 't', userId: 1 })
  useInventoryStore().items = [mk()]
  useResourcesStore().spiritStone = gn(balance.stone)
  useResourcesStore().dust = balance.dust
  usePlayerStore().exp = gn(balance.exp)
}

function stoneNow(): number {
  return toNum(useResourcesStore().spiritStone)
}

beforeEach(() => {
  forgeOp.mockReset()
})

describe('在线炼器 · 扣款按服务端裁定的 spend 落本地', () => {
  it('单次强化成功:灵石 / 器灵尘 / 修为三样都减', async () => {
    seat()
    const spend = { stone: gn(1200), dust: 30, exp: gn(4000) }
    forgeOp.mockResolvedValue({
      ok: true,
      op: 'upgrade',
      items: [mk(1)],
      spend,
      detail: { kind: 'upgrade', outcome: 'up', levelBefore: 0, levelAfter: 1, tries: 1 }
    })
    const outcome = await requestUpgrade(UID, { quiet: true })
    expect(outcome).toBe('up')
    expect(stoneNow()).toBeCloseTo(1e9 - 1200, 0)
    expect(useResourcesStore().dust).toBe(5000 - 30)
    expect(toNum(usePlayerStore().exp)).toBeCloseTo(1e9 - 4000, 0)
  })

  it('连强:按回传的总账扣一次,不按本地估算', async () => {
    seat()
    forgeOp.mockResolvedValue({
      ok: true,
      op: 'upgrade',
      items: [mk(3)],
      spend: { stone: gn(9000), dust: 60, exp: gn(12000) },
      detail: { kind: 'upgrade', outcome: 'up', levelBefore: 0, levelAfter: 3, tries: 3 }
    })
    await upgradeEquipmentBatch(UID)
    expect(stoneNow()).toBeCloseTo(1e9 - 9000, 0)
    expect(useResourcesStore().dust).toBe(5000 - 60)
    expect(toNum(usePlayerStore().exp)).toBeCloseTo(1e9 - 12000, 0)
  })

  it('被拒(缺料/满级)时一样不动', async () => {
    seat()
    forgeOp.mockResolvedValue({
      ok: false,
      reason: 'stone',
      spend: { stone: gn(0), dust: 0, exp: gn(0) },
      detail: { kind: 'upgrade', outcome: 'blocked', block: 'stone', levelBefore: 0, levelAfter: 0, tries: 0 }
    })
    expect(await requestUpgrade(UID, { quiet: true })).toBe('blocked')
    expect(stoneNow()).toBe(1e9)
    expect(useResourcesStore().dust).toBe(5000)
    expect(toNum(usePlayerStore().exp)).toBe(1e9)
  })

  it('重铸成功:石与尘照扣', async () => {
    seat()
    forgeOp.mockResolvedValue({
      ok: true,
      op: 'reforge',
      items: [mk(0)],
      spend: { stone: gn(800), dust: 40, exp: gn(0) },
      detail: { kind: 'reforge', outcome: 'done', countBefore: 1, countAfter: 2 }
    })
    expect(await requestReforge(UID, true)).toBe(true)
    expect(stoneNow()).toBeCloseTo(1e9 - 800, 0)
    expect(useResourcesStore().dust).toBe(5000 - 40)
  })

  it('词条转移成功:石与尘照扣', async () => {
    seat()
    forgeOp.mockResolvedValue({
      ok: true,
      op: 'transfer',
      items: [mk(0)],
      spend: { stone: gn(300), dust: 15, exp: gn(0) },
      detail: { kind: 'transfer', ok: true }
    })
    await requestTransfer({ sourceUid: UID, targetUid: UID, affixId: 'a_x', replaceId: null, seal: false })
    expect(stoneNow()).toBeCloseTo(1e9 - 300, 0)
    expect(useResourcesStore().dust).toBe(5000 - 15)
  })

  it('本地余额比服务端旧(不够扣):照扣到 0,不留半笔', async () => {
    // 服务端按「云档与上报的较大者」放行,本地可能已被别的动作花掉一部分
    seat({ stone: 100, dust: 5, exp: 100 })
    forgeOp.mockResolvedValue({
      ok: true,
      op: 'upgrade',
      items: [mk(1)],
      spend: { stone: gn(1200), dust: 30, exp: gn(4000) },
      detail: { kind: 'upgrade', outcome: 'up', levelBefore: 0, levelAfter: 1, tries: 1 }
    })
    await requestUpgrade(UID, { quiet: true })
    expect(stoneNow()).toBe(0)
    expect(useResourcesStore().dust).toBe(0)
    expect(toNum(usePlayerStore().exp)).toBe(0)
    // 参考实现:扣到 0 而不是负数(与 subClamp 同向)
    expect(subClamp(gn(1), gn(2)).m).toBe(0)
  })
})
