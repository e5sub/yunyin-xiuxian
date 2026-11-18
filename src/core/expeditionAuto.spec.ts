/**
 * 全自动远征(core/expedition 的自动续行)与历练并行的边界:
 *   一 出发后全自动:自动择径(实战同源胜算,平手取道源厚者)+ 自动决战界主,败/契碎/破界即止;
 *   二 非 VIP 每日 5 次、VIP 不限;额度按真实日计,跨世保留,换日即归零;
 *   三 远征与历练并行:历练在途照样启程(互斥已撤),秘境仍独占。
 * 战斗走真实路径(顶配真仙打赤炎天),不 mock combat —— 要钉的是状态机与账,不是胜负。
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { usePlayerStore } from '@/stores/player'
import { useInventoryStore } from '@/stores/inventory'
import { useEndgameStore } from '@/stores/endgame'
import { useAuthStore } from '@/stores/auth'
import { useAdventureStore } from '@/stores/adventure'
import { CELESTIAL_WORLDS, EXPEDITION_ROUTE_LAYERS } from '@/data/endgame'
import {
  EXPEDITION_AUTO_DAILY_LIMIT,
  autoAdvanceExpedition,
  autoRunsUsed,
  canAutoExpedition,
  noteAutoExpedition,
  startWorldExpedition
} from './expedition'
import { localDayNum } from '@/utils/time'
import { gn } from '@/utils/gnum'
import type { EquipSlot, EquipmentInstance } from '@/types'

const SLOTS: EquipSlot[] = ['weapon', 'head', 'body', 'wrist', 'belt', 'boots', 'necklace', 'ring', 'talisman']
/** 人间界顶配一身(与 expedition.spec 同一套:真仙打赤炎天够得着) */
const MORTAL_TOP = ['w_jiujie', 'h_zichen', 'b_taiqing', 'wr_jieyun', 'bl_yunlei', 'bo_lingxu', 'n_jiuzhuan', 'r_ziyuan', 'tl_yulei']

function seated(major: number, tpls: string[], quality: EquipmentInstance['quality'], tier: number): void {
  const player = usePlayerStore()
  player.initCharacter('自动远征自检', { roots: [{ element: 'wood', aptitude: 90 }] } as never)
  player.major = major
  player.sub = 9
  const inv = useInventoryStore()
  inv.items = tpls.map((templateId, i): EquipmentInstance => ({
    uid: `x${i}`,
    templateId,
    quality,
    tier,
    level: 5,
    affixes: [{ id: 'atk4', roll: 0.8 }, { id: 'hp4', roll: 0.6 }, { id: 'def4', roll: 0.6 }]
  }))
  inv.items.forEach((it, i) => inv.equip(it.uid, SLOTS[i]!))
  const endgame = useEndgameStore()
  endgame.daoPath = 'sword'
  endgame.addDaoSource(5000)
}

function signInVip(vip: boolean): void {
  const auth = useAuthStore()
  auth.token = 'tk'
  auth.userId = 7
  auth.vipUntil = vip ? Date.now() + 86_400_000 : 0
}

beforeEach(() => {
  setActivePinia(createPinia())
  signInVip(false)
})

describe('全自动远征 · 一路打到终局', () => {
  it('出发即自动续行:终局即止(run 清空),破界则全程 ROWS = 入界+层数+界主', () => {
    seated(9, MORTAL_TOP, 'heaven', 20)
    const eg = useEndgameStore()
    const outcome = startWorldExpedition('chiyan', null)
    expect(outcome, '顶配真仙入赤炎天,启程本身不该被拒').not.toBeNull()
    if (outcome!.type === 'advance') {
      const final = autoAdvanceExpedition()
      expect(final, '自动续行必有终局战果').not.toBeNull()
      expect(final!.type, '终局即止:不许停在 advance').not.toBe('advance')
      expect(eg.worldRun, '败/契碎/破界都会 settle,run 必清').toBeNull()
      if (final!.type === 'cleared') {
        expect(final!.finalRows?.length, '破界全程 = 入界+层数+界主').toBe(EXPEDITION_ROUTE_LAYERS + 2)
      }
    } else {
      // 首战即败也算路径:run 已清,自动续行无事可做
      expect(eg.worldRun).toBeNull()
      expect(autoAdvanceExpedition()).toBeNull()
    }
  })

  it('无在途时自动续行是空操作', () => {
    expect(autoAdvanceExpedition()).toBeNull()
  })
})

describe('全自动额度 · 非 VIP 每日 5 次,VIP 不限', () => {
  it('非 VIP 记满 5 次即不能再全自动;再记也只到上限语义(第 6 次不享受)', () => {
    expect(canAutoExpedition(), '一天刚开始,额度满的').toBe(true)
    for (let i = 0; i < EXPEDITION_AUTO_DAILY_LIMIT; i += 1) {
      expect(canAutoExpedition()).toBe(true)
      noteAutoExpedition()
    }
    expect(autoRunsUsed()).toBe(EXPEDITION_AUTO_DAILY_LIMIT)
    expect(canAutoExpedition(), '额度用尽').toBe(false)
  })

  it('VIP 不限:记再多也放行', () => {
    signInVip(true)
    for (let i = 0; i < EXPEDITION_AUTO_DAILY_LIMIT + 3; i += 1) noteAutoExpedition()
    expect(canAutoExpedition()).toBe(true)
  })

  it('换日归零:昨天的次数不占今天的额度', () => {
    const eg = useEndgameStore()
    for (let i = 0; i < EXPEDITION_AUTO_DAILY_LIMIT; i += 1) noteAutoExpedition()
    expect(canAutoExpedition()).toBe(false)
    eg.autoRunDay = localDayNum(Date.now()) - 1
    expect(autoRunsUsed(), '换了日号即视为未用').toBe(0)
    expect(canAutoExpedition()).toBe(true)
  })
})

describe('远征与历练并行 · 出发不再被历练拦', () => {
  it('历练在途照样启程:远征落 run,历练会话分文未动', () => {
    seated(9, MORTAL_TOP, 'heaven', 20)
    const adventure = useAdventureStore()
    adventure.setSession({
      regionId: 'qingyun',
      mode: 'normal',
      startedAt: 0,
      endsAt: Date.now() + 60_000,
      nextBattleAt: Date.now() + 10_000,
      wins: 0,
      losses: 0,
      events: 0,
      stoneGain: gn(0),
      expGain: gn(0),
      itemGain: 0
    })
    const outcome = startWorldExpedition('chiyan', null)
    expect(outcome, '历练在途仍可入界(并行)').not.toBeNull()
    const eg = useEndgameStore()
    expect(eg.worldRun?.worldId).toBe('chiyan')
    expect(adventure.session, '历练会话原样保留').not.toBeNull()
  })
})

describe('自动择径 · 与手动同源', () => {
  it('每一界的两条径都能被自动选中(择径函数不给 null 卡死全程)', () => {
    // 只验结构:各界各层恰有两条径,自动择径在这两条里取一,不越界
    for (const w of CELESTIAL_WORLDS) {
      for (let layer = 0; layer < EXPEDITION_ROUTE_LAYERS; layer += 1) {
        expect(w.routes[layer]?.length, `${w.id} 第 ${layer + 1} 重应两径可择`).toBe(2)
      }
    }
  })
})
