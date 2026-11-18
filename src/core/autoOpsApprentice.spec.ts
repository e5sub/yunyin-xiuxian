/**
 * 道童差事托管(core/autoOps 的 autoApprenticeTick)的取舍与边界:
 *   一 非 VIP 概不动手,开关到期自动关停(只暂停,不清开关);
 *   二 开关与「自动历练」同源:没开历练就只当没这回事;
 *   三 完工即收(走服务端差事账),闲置即按「各尽其长」再派 —— 与道童页一键同规;
 *   四 云不可达时静默跳过,下一轮再说(不弹错、不重试轰炸)。
 * 云接口与差事 store 的动作都走替身:托管只认「回什么」,不认界面怎么显示。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { OwnedApprentice } from '@/core/apprenticeService'
import { taskDef } from '@/data/apprentices'

const cloud = vi.hoisted(() => ({
  apprenticeTaskClaim: vi.fn(),
  apprenticeTaskStart: vi.fn()
}))

vi.mock('@/services/cloud', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/cloud')>()),
  cloudApi: cloud
}))

import { autoApprenticeTick, stopAutoOps } from './autoOps'
import { useApprenticeStore } from '@/stores/apprentice'
import { useAuthStore } from '@/stores/auth'
import { useGameStore } from '@/stores/game'
import { useResourcesStore } from '@/stores/resources'
import { useSettingsStore } from '@/stores/settings'
import { herbGradeOfMajor } from '@/data/herbGrades'

/** 登录且置成 VIP/非 VIP:auth 的 loggedIn/isVip 是 computed,只能从 token/userId/vipUntil 播种 */
function signIn(vip: boolean): void {
  const auth = useAuthStore()
  auth.token = 'tk'
  auth.userId = 7
  auth.vipUntil = vip ? Date.now() + 86_400_000 : 0
  useGameStore().started = true
}

/** 一名道童:可选在途差事 */
function make(archId: string, task: OwnedApprentice['task']): OwnedApprentice {
  return { uid: `apt_${archId}`, archId, level: 3, bond: 0, task }
}

/** 一单已完工的采药差事(过去时的开工/完工时刻) */
function doneTask(spec: OwnedApprentice['task'] extends null ? never : NonNullable<OwnedApprentice['task']>['spec']): NonNullable<OwnedApprentice['task']> {
  const seconds = taskDef(spec).seconds
  return { spec, startAt: Date.now() - seconds * 1000 - 5000, finishAt: Date.now() - 5000 }
}

beforeEach(() => {
  setActivePinia(createPinia())
  // 模块级的计时/冷却随循环停启归零,否则上一用例的失败冷却会让这一轮的 tick 直接跳过
  stopAutoOps()
  cloud.apprenticeTaskClaim.mockReset()
  cloud.apprenticeTaskStart.mockReset()
  useSettingsStore().autoAdventure = true
})

describe('道童差事托管的边界', () => {
  it('未登录一概不动手', async () => {
    useGameStore().started = true
    await autoApprenticeTick()
    expect(cloud.apprenticeTaskClaim).not.toHaveBeenCalled()
    expect(cloud.apprenticeTaskStart).not.toHaveBeenCalled()
  })

  it('非 VIP 不动手,开关原样保留(到期只暂停,续费即恢复)', async () => {
    signIn(false)
    await autoApprenticeTick()
    expect(cloud.apprenticeTaskClaim).not.toHaveBeenCalled()
    expect(useSettingsStore().autoAdventure).toBe(true)
  })

  it('没开自动历练就只当没这回事(差事随历练开关)', async () => {
    signIn(true)
    useSettingsStore().autoAdventure = false
    await autoApprenticeTick()
    expect(cloud.apprenticeTaskClaim).not.toHaveBeenCalled()
    expect(cloud.apprenticeTaskStart).not.toHaveBeenCalled()
  })

  it('完工即收、闲置即派:产出照服务端回传入账,新单开工入账', async () => {
    signIn(true)
    const a = useApprenticeStore()
    a.$patch({
      apprentices: [
        make('ap_luanniao', doneTask('herb')),
        make('ap_kuangtou', null)
      ]
    })
    cloud.apprenticeTaskClaim.mockResolvedValue({ ok: true, spoils: { stone: 120, herb: 9 } })
    cloud.apprenticeTaskStart.mockResolvedValue({ ok: true })

    await autoApprenticeTick()

    // 收工:服务端回传的产出入账,道童进阶
    const res = useResourcesStore()
    expect(res.spiritStone.m, '灵石入账').toBeGreaterThan(0)
    expect(res.herbOf(herbGradeOfMajor(0)), '灵草入账').toBe(9)
    expect(a.apprentices[0]!.level).toBe(4)
    // 派遣:收工回闲的与本来闲置的都该有新差事(开工账已入服务端)
    expect(cloud.apprenticeTaskStart).toHaveBeenCalledTimes(2)
    for (const appr of a.apprentices) {
      expect(appr.task, `${appr.archId} 派上新活`).not.toBeNull()
    }
  })

  it('都无活可办时一单不发', async () => {
    signIn(true)
    const a = useApprenticeStore()
    a.$patch({ apprentices: [make('ap_luanniao', { spec: 'herb', startAt: Date.now() - 1000, finishAt: Date.now() + 3600_000 })] })
    await autoApprenticeTick()
    expect(cloud.apprenticeTaskClaim).not.toHaveBeenCalled()
    expect(cloud.apprenticeTaskStart).not.toHaveBeenCalled()
  })

  it('云不可达时静默跳过:不弹错,下一轮再说', async () => {
    signIn(true)
    const a = useApprenticeStore()
    a.$patch({ apprentices: [make('ap_luanniao', doneTask('herb'))] })
    cloud.apprenticeTaskClaim.mockRejectedValue(new Error('网络异常'))
    await autoApprenticeTick()
    // 差事保留(1.74.1 的卡死兜底在 store 内部,60 秒后作废,这里只验托管不炸)
    expect(a.apprentices[0]!.task).not.toBeNull()
    expect(cloud.apprenticeTaskStart).not.toHaveBeenCalled()
  })
})
