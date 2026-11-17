/**
 * 结算闸 · 连点不清空灵石(1.74.0)。
 *
 * 「强化有时候把灵石清空」查下来是两个叠在一起的口径错:
 *   ① **一笔结算被扣了多次** —— 同一个 op 在途时多个调用方共用同一个 promise,
 *      服务端只结算一笔,本地却各自 `chargeRemoteSpend(res.spend)` 扣一遍;
 *      余额不够时 subClamp 压到 0。一键强化一次是全身的价,双扣足以清零。
 *   ② **两笔结算同时采信同一份余额** —— 钱是本地扣的,服务端按请求里带的余额判付得起。
 *      并发的两笔都带着「还没扣过」的数出门,服务端各自按全额记账,本地第二笔扣到 0。
 *
 * 这组判据钉住:同一笔结算只落一次账、不同结算串行且后一笔读到的是扣过的余额、
 * 闸不会因为一笔失败而堵死。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { EquipmentInstance } from '@/types'
import { gn, toNum } from '@/utils/gnum'
import { useAuthStore } from '@/stores/auth'
import { useInventoryStore } from '@/stores/inventory'
import { usePlayerStore } from '@/stores/player'
import { useResourcesStore } from '@/stores/resources'

const { forgeOp } = vi.hoisted(() => ({ forgeOp: vi.fn() }))

vi.mock('@/services/cloud', () => ({ cloudApi: { forgeOp } }))
// 展示层音效在无窗环境没有 Audio:只留空实现
vi.mock('./audio', () => ({ playSfx: () => {} }))
// 簿记会推进任务/成就,达成时发奖会把扣款断言搅成净值(与 forgeServiceCharge.spec 同因)
vi.mock('./forge', async importOriginal => {
  const actual = await importOriginal<typeof import('./forge')>()
  return { ...actual, noteUpgrade: () => {} }
})
vi.mock('./reforge', async importOriginal => {
  const actual = await importOriginal<typeof import('./reforge')>()
  return { ...actual, noteReforge: () => {} }
})

const UID = 'u_settle'

function mk(level = 0): EquipmentInstance {
  return { uid: UID, templateId: 'b_qingyun', quality: 'mortal', tier: 3, level, affixes: [] }
}

/** 服务端回包:一次强化花掉 3000 石 / 30 尘 / 100 修为 */
function reply(): Record<string, unknown> {
  return {
    ok: true,
    op: 'upgrade',
    items: [mk(1)],
    spend: { stone: gn(3000), dust: 30, exp: gn(100) },
    detail: { kind: 'upgrade', outcome: 'up', levelBefore: 0, levelAfter: 1, tries: 1 }
  }
}

/** 登录态 + 一件凡品 + 余额只够一次(5000) */
function seat(): void {
  setActivePinia(createPinia())
  useAuthStore().$patch({ token: 't', userId: 1 })
  useInventoryStore().items = [mk()]
  useResourcesStore().spiritStone = gn(5000)
  useResourcesStore().dust = 5000
  usePlayerStore().exp = gn(1e9)
}

function stoneNow(): number {
  return toNum(useResourcesStore().spiritStone)
}

beforeEach(() => {
  forgeOp.mockReset()
})

describe('结算闸 · 同一份余额不被两笔结算同时采信', () => {
  it('同一件连点两下:服务端只结算一笔,本地也只扣一笔', async () => {
    seat()
    let release: (v: unknown) => void = () => {}
    forgeOp.mockImplementation(
      () =>
        new Promise(resolve => {
          release = resolve
        })
    )
    const { requestUpgrade } = await import('./forgeService')
    const a = requestUpgrade(UID, { quiet: true })
    const b = requestUpgrade(UID, { quiet: true })
    // 请求排在结算闸里,进闸是下一个微任务的事:等它真的发出去了再放行
    await vi.waitFor(() => expect(forgeOp).toHaveBeenCalled())
    release(reply())
    await Promise.all([a, b])
    expect(forgeOp).toHaveBeenCalledTimes(1)
    // 修前这里是 0 —— 5000 被扣了两遍 3000,subClamp 压平
    expect(stoneNow()).toBeCloseTo(2000, 0)
    expect(useResourcesStore().dust).toBe(5000 - 30)
  })

  it('两笔不同结算并发:后一笔按扣过的余额去问,余额不够就被服务端拦下', async () => {
    seat()
    const seen: number[] = []
    // 服务端口径:按请求里带的余额判付得起(付不起就拒,与 forgeResolve 同规)
    forgeOp.mockImplementation(async (...args: unknown[]) => {
      const body = args[0] as { stone: { m: number; e: number } }
      const have = body.stone.m * 10 ** body.stone.e
      seen.push(have)
      if (have < 3000) {
        return {
          ok: false,
          reason: 'stone',
          detail: { kind: 'upgrade', outcome: 'blocked', block: 'stone', levelBefore: 0, levelAfter: 0, tries: 0 }
        }
      }
      return reply()
    })
    const { requestUpgrade, requestReforge } = await import('./forgeService')
    // 不同的 op 才会各自排队(同 key 会合并成同一笔):重铸与强化各一笔
    await Promise.all([requestUpgrade(UID, { quiet: true }), requestReforge(UID, true)])
    // 第二笔看到的是第一笔扣完的 2000,不是同一份 5000 —— 修前两笔都会报 5000
    expect(seen).toEqual([5000, 2000])
    expect(stoneNow()).toBeCloseTo(2000, 0)
  })

  it('前一笔抛错不堵住队列:后面照常结算', async () => {
    seat()
    forgeOp.mockRejectedValueOnce(new Error('网络不通')).mockResolvedValueOnce(reply())
    const { requestUpgrade } = await import('./forgeService')
    expect(await requestUpgrade(UID, { quiet: true })).toBe('blocked')
    expect(stoneNow()).toBe(5000)
    expect(await requestUpgrade(UID, { quiet: true })).toBe('up')
    expect(stoneNow()).toBeCloseTo(2000, 0)
  })

  it('在途笔数回到 0 之后才放开按钮', async () => {
    seat()
    forgeOp.mockResolvedValue(reply())
    const { settling } = await import('./settleQueue')
    const { requestUpgrade } = await import('./forgeService')
    expect(settling.value).toBe(0)
    const p = requestUpgrade(UID, { quiet: true })
    expect(settling.value).toBe(1)
    await p
    expect(settling.value).toBe(0)
  })
})
