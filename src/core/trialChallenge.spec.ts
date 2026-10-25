/**
 * 天道试炼(TRIALS:qisha/yixian/wuhui)challengeTrial 守卫。
 * 钉:顶配清试炼扣入界费、赏 rewardDaoSource、记谱(clears/best);裸装败试炼不赏、不记谱,入界费照扣。
 * 不 mock 战斗/渡劫:endgameService.spec 的 tribulationDecision mock 会压弱 celestialStats,顶配清不了试炼。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { usePlayerStore } from '@/stores/player'
import { useInventoryStore } from '@/stores/inventory'
import { useEndgameStore } from '@/stores/endgame'
import { useAdventureStore } from '@/stores/adventure'
import { useUiStore } from '@/stores/ui'
import { TRIALS, trialDef, celestialWorldDef } from '@/data/endgame'
import { challengeTrial, replayMark, rewriteMark, REWRITE_ENTRY_COST } from './endgameService'
import { gn } from '@/utils/gnum'
import type { EquipSlot, EquipmentInstance } from '@/types'

const S_SLOTS: EquipSlot[] = ['weapon', 'head', 'body', 'wrist', 'belt', 'boots', 'necklace', 'ring', 'talisman']
const S_CHAOS_TOP = ['w_benyuan', 'h_benyuan', 'b_benyuanshen', 'wr_benyuan', 'bl_benyuan', 'bo_benyuan', 'n_hongmengzhu', 'r_daozu', 'tl_daozuzhuan']

describe('天道试炼 · challengeTrial 清/败原子', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  function seedTrialPlayer(topGear: boolean): void {
    const player = usePlayerStore()
    player.initCharacter('天道自检', { roots: [{ element: 'wood', aptitude: 90 }] } as never)
    player.major = 20
    player.sub = 9
    if (topGear) {
      const inv = useInventoryStore()
      inv.items = S_CHAOS_TOP.map((templateId, i): EquipmentInstance => ({
        uid: `t${i}`, templateId, quality: 'divine', tier: 60, level: 25,
        affixes: [{ id: 'atk4', roll: 0.8 }, { id: 'hp4', roll: 0.6 }, { id: 'def4', roll: 0.6 }]
      }))
      inv.items.forEach((it, i) => inv.equip(it.uid, S_SLOTS[i]!))
    }
    const e = useEndgameStore()
    e.daoPath = 'sword'
    e.addDaoSource(500)
  }

  it('顶配清 qisha:扣入界费、赏 rewardDaoSource、记谱(clears/best)、全捷战数=试炼场数', () => {
    seedTrialPlayer(true)
    const e = useEndgameStore()
    const before = e.daoSource
    const t = trialDef('qisha')!
    const out = challengeTrial('qisha')!
    expect(out.report.cleared, 'qisha cleared=false, fw='+out.report.fightsWon).toBe(true)
    expect(out.report.fightsWon).toBe(t.fights)
    expect(out.rewardDaoSource).toBe(t.rewardDaoSource)
    expect(before - e.daoSource).toBe(t.entryCost - t.rewardDaoSource)
    expect(e.trialRecords['qisha']?.clears).toBe(1)
    expect(e.trialRecords['qisha']?.bestRounds).toBe(out.report.totalRounds)
  })

  it('裸装败 qisha:不赏、不记谱,入界费照扣', () => {
    seedTrialPlayer(false)
    const e = useEndgameStore()
    const before = e.daoSource
    const out = challengeTrial('qisha')!
    expect(out.report.cleared).toBe(false)
    expect(out.rewardDaoSource).toBe(0)
    expect(before - e.daoSource).toBe(trialDef('qisha')!.entryCost)
    expect(e.trialRecords['qisha']).toBeUndefined()
  })

  it('每道试炼都定义入界费/奖励/场数/escalation 且值有限为正(避开跑战斗)', () => {
    for (const t of TRIALS) {
      expect(Number.isFinite(t.entryCost) && t.entryCost > 0, `${t.id} entryCost`).toBe(true)
      expect(Number.isFinite(t.rewardDaoSource) && t.rewardDaoSource > 0, `${t.id} reward`).toBe(true)
      expect(Number.isInteger(t.fights) && t.fights > 0, `${t.id} fights`).toBe(true)
      expect(Number.isFinite(t.escalation) && t.escalation >= 1, `${t.id} escalation`).toBe(true)
    }
  })

  it('可重写世界道痕:扣 10 道源、真跑一趟并补新痕 —— 不再烧钱白回 null', () => {
    seedTrialPlayer(true)
    const e = useEndgameStore()
    const world = celestialWorldDef('chiyan')!
    e.addMark({
      life: 1,
      daoPathId: 'sword',
      targetId: 'chiyan',
      targetName: world.name,
      cleared: true,
      rounds: 9999, // 今日必更快;走「胜于旧我」不碍断言
      buildName: '天道自检',
      powerText: '1e100',
      at: Date.now(),
      replay: { mods: {}, attack: gn(1), defense: gn(1), maxHp: gn(10), speed: 1, skills: [], artifacts: [], pactId: null }
    })
    const before = e.daoSource
    const marksBefore = e.marks.length
    const out = rewriteMark(e.marks[0]!)
    expect(out, '世界道痕重写不应白回 null').not.toBeNull()
    expect(before - e.daoSource).toBe(REWRITE_ENTRY_COST)
    expect(e.marks.length).toBe(marksBefore + 1)
  })

  /** 忆战/重写须同变数:共享 rng 会让同一痕连打两次战报不同 */
  it('忆战/重写是「同变数」:同一道痕连打两次,逐回合战报相同', () => {
    seedTrialPlayer(true)
    const e = useEndgameStore()
    const world = celestialWorldDef('chiyan')!
    e.addMark({
      life: 1,
      daoPathId: 'sword',
      targetId: 'chiyan',
      targetName: world.name,
      cleared: true,
      rounds: 9999,
      buildName: '天道自检',
      powerText: '1e100',
      at: Date.now(),
      replay: { mods: {}, attack: gn(1000), defense: gn(600), maxHp: gn(20000), speed: 2, skills: [], artifacts: [], pactId: null }
    })
    const mark = e.marks[0]!
    const replayA = replayMark(mark)!
    const replayB = replayMark(mark)!
    expect(JSON.stringify(replayB.report.rows), '忆战该逐回合同变数').toBe(JSON.stringify(replayA.report.rows))
    const rewriteA = rewriteMark(mark)!
    const rewriteB = rewriteMark(mark)!
    expect(JSON.stringify(rewriteB.report.rows), '重写该逐回合同变数').toBe(JSON.stringify(rewriteA.report.rows))
  })

  it('天道试炼押道源入场,同一试炼连打两次战报相同', () => {
    seedTrialPlayer(true)
    const a = challengeTrial('qisha')!
    const b = challengeTrial('qisha')!
    expect(JSON.stringify(b.report.rows), '同一试炼该逐回合同变数').toBe(JSON.stringify(a.report.rows))
  })

  it('秘境在途:试炼与重写都在扣费前拒绝', () => {
    seedTrialPlayer(true)
    const player = usePlayerStore()
    const e = useEndgameStore()
    player.secretRealm = {
      realmId: 'sr_kurong', enteredAt: 1, layer: 1, wins: 0, losses: 0, spoils: [], rules: [], carriedHpPct: 1, finished: false
    }
    e.addMark({
      life: 1,
      daoPathId: 'sword',
      targetId: 'chiyan',
      targetName: celestialWorldDef('chiyan')!.name,
      cleared: true,
      rounds: 99,
      buildName: '天道自检',
      powerText: '1e100',
      at: Date.now(),
      replay: { mods: {}, attack: gn(1), defense: gn(1), maxHp: gn(10), speed: 1, skills: [], artifacts: [], pactId: null }
    })
    const before = e.daoSource
    expect(challengeTrial('qisha')).toBeNull()
    expect(rewriteMark(e.marks[0]!)).toBeNull()
    expect(e.daoSource, '在途拒绝不得扣道源').toBe(before)
  })

  it('历练在途:试炼与重写都在扣费前拒绝', () => {
    seedTrialPlayer(true)
    const e = useEndgameStore()
    useAdventureStore().setSession({
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
    e.addMark({
      life: 1,
      daoPathId: 'sword',
      targetId: 'chiyan',
      targetName: celestialWorldDef('chiyan')!.name,
      cleared: true,
      rounds: 99,
      buildName: '天道自检',
      powerText: '1e100',
      at: Date.now(),
      replay: { mods: {}, attack: gn(1), defense: gn(1), maxHp: gn(10), speed: 1, skills: [], artifacts: [], pactId: null }
    })
    const before = e.daoSource
    expect(challengeTrial('qisha'), '历练在途仍可应试').toBeNull()
    expect(rewriteMark(e.marks[0]!), '历练在途仍可重写').toBeNull()
    expect(e.daoSource, '在途拒绝不得扣道源').toBe(before)
    expect(useUiStore().toasts.at(-1)?.text).toContain('历练在途')
  })
})
