/**
 * 转世交割端到端契约(confirmReincarnation),对应 ReincarnationDialog「此生交割」与 DEC-003:
 * 留下「我是谁」,放下「我拥有多少」,转世重掷道号。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { usePlayerStore } from '@/stores/player'
import { useResourcesStore } from '@/stores/resources'
import { useInventoryStore } from '@/stores/inventory'
import { useCultivationStore } from '@/stores/cultivation'
import { useAdventureStore } from '@/stores/adventure'
import { useUiStore } from '@/stores/ui'
import { useEndgameStore } from '@/stores/endgame'
import { useDongfuStore } from '@/stores/dongfu'
import { useApprenticeStore } from '@/stores/apprentice'
import { useLoreStore } from '@/stores/lore'
import { useQuestsStore } from '@/stores/quests'
import { STARTER_APPRENTICE } from '@/data/apprentices'
import { prepareReincarnation, confirmReincarnation } from '@/core/reincarnation'
import { signLifeTrial, lifeTrialRules } from '@/core/lifeTrialService'
import { gn, toNum } from '@/utils/gnum'

/** 摆好一个有存量的人生:境界、资源装备、跨世资产、记忆 */
function seedLife(): void {
  const player = usePlayerStore()
  const res = useResourcesStore()
  const inv = useInventoryStore()
  const cult = useCultivationStore()
  const adv = useAdventureStore()
  const dongfu = useDongfuStore()
  const quests = useQuestsStore()
  const endgame = useEndgameStore()
  const lore = useLoreStore()

  player.initCharacter('旧道号', { roots: [] } as never)
  player.major = 5
  player.sub = 8
  player.exp = gn(1000)
  player.age = 300

  res.spiritStone = gn(99999)
  res.setQi(500, 100)
  res.wudao = 50
  res.herbByGrade[1] = 40
  res.ore = 30
  res.page = 20
  res.dust = 10

  inv.items = [{ uid: 'i1' }] as never
  inv.equipped = { weapon: 'i1' } as never
  inv.pills = { p_jvqisan: 3 }
  inv.artifacts = [{ uid: 'a1' }] as never
  inv.equippedArtifacts = ['a1']

  cult.learned = { m_taixuan: 5, m_jinlian: 3 }
  cult.buffs = [{ id: 'b1', until: 999 }] as never
  cult.mainGongfa = 'm_taixuan'

  adv.unlocked = ['qingyun', 'luoxia']
  adv.cleared = ['qingyun']
  dongfu.setLevel('field', 8)
  player.setPet('pet_yueying')
  useApprenticeStore().$patch({
    apprentices: [{ uid: 'apt1', archId: STARTER_APPRENTICE, level: 3, bond: 20, task: null }] as never
  })

  // 跨世资产
  player.reincarnation.daoFruit = 100
  player.reincarnation.talents = ['t_xian']
  player.reincarnation.insight = 40
  player.titleId = 'ti_lianxu'
  player.nemeses = [{ id: 'n_one', avengedAt: 1 }] as never
  player.regionStats = { qingyun: { totalFights: 30 } } as never
  player.fortuneChoices = { ft_sword_remnant: 'take' }
  player.eventChains = { old_man_stone: 2 }
  quests.counters = { kills: 99 } as never
  lore.materialLore = { m_lingzhi: 2 }
  endgame.daoSource = 5
  endgame.souls = [{ uid: 's1' }] as never
  endgame.equippedSouls = ['s1']
}

describe('转世交割 · confirmReincarnation', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    seedLife()
  })

  it('放下「我拥有多少」:境界/资源/装备/法宝/丹药/灵兽/洞府/灵脉/区域全部归零', () => {
    const player = usePlayerStore()
    const res = useResourcesStore()
    const inv = useInventoryStore()
    const cult = useCultivationStore()
    const adv = useAdventureStore()
    const dongfu = useDongfuStore()
    const appr = useApprenticeStore()

    prepareReincarnation()
    confirmReincarnation(null)

    expect(player.major).toBe(0)
    expect(player.sub).toBe(0)
    expect(toNum(player.exp)).toBe(0)
    // a_re1(完成第一次转世)会给新世补发灵石与悟道:灵石只断言存量消失,悟道不断言
    expect(toNum(res.spiritStone)).toBeLessThan(1000)
    expect(res.herb).toBe(0)
    expect(res.ore).toBe(0)
    expect(res.page).toBe(0)
    expect(res.dust).toBe(0)
    expect(res.qi).toBe(0)
    expect(inv.items).toHaveLength(0)
    expect(inv.equipped).toEqual({})
    expect(inv.pills).toEqual({})
    expect(inv.artifacts).toHaveLength(0)
    expect(inv.equippedArtifacts).toEqual([])
    expect(cult.buffs).toHaveLength(0)
    expect(adv.unlocked).toEqual(['qingyun'])
    expect(adv.cleared).toEqual([])
    expect(player.petId).toBeNull()
    expect(dongfu.levels.field).toBe(0)
    expect(appr.apprentices, '道童随转世散去').toHaveLength(0)
    expect(appr.rebirthKarma, 'seedLife 的 bond:20 未达真传,不凝缘').toBe(0)
  })

  it('真传道童转世:道童本体散去,但一丝缘(rebirthKarma)随世带走', () => {
    const appr = useApprenticeStore()
    useApprenticeStore().$patch({
      apprentices: [{ uid: 'apt2', archId: STARTER_APPRENTICE, level: 9, bond: 150, task: null }] as never
    })
    prepareReincarnation()
    confirmReincarnation(null)
    expect(appr.apprentices, '道童本体仍随世散去').toHaveLength(0)
    expect(appr.rebirthKarma, '真传之缘随世带走,封顶到真传位阶').toBe(100)
  })

  it('带走「我是谁」:道果/天赋/宿慧/称号/认知/道源道痕/世界记忆全部保留', () => {
    const player = usePlayerStore()
    const lore = useLoreStore()
    const endgame = useEndgameStore()
    const quests = useQuestsStore()
    const fruitBefore = player.reincarnation.daoFruit

    prepareReincarnation()
    confirmReincarnation(null)

    expect(player.reincarnation.daoFruit).toBeGreaterThan(fruitBefore)
    expect(player.reincarnation.talents).toContain('t_xian')
    expect(player.reincarnation.insight).toBeGreaterThan(40)
    expect(player.titleId).toBe('ti_lianxu')
    expect(lore.materialLore.m_lingzhi).toBe(2)
    expect(endgame.daoSource).toBe(5)
    expect(endgame.souls).toHaveLength(1)
    expect(player.fortuneChoices).toEqual({ ft_sword_remnant: 'take' })
    expect(player.eventChains).toEqual({ old_man_stone: 2 })
    expect(player.nemeses).toHaveLength(1)
    expect(player.regionStats.qingyun!.totalFights).toBe(30)
    expect(quests.counters.kills).toBe(99)
  })

  it('新的皮囊换新的道号:转世重掷姓名,不沿用旧名', () => {
    const player = usePlayerStore()
    const before = player.name

    prepareReincarnation()
    confirmReincarnation(null)

    expect(player.name).not.toBe(before)
    expect(player.name.length).toBeGreaterThan(0)
  })

  it('功法半留:门类记得,层数回到一层', () => {
    const cult = useCultivationStore()

    prepareReincarnation()
    confirmReincarnation(null)

    expect(cult.learned.m_taixuan).toBeGreaterThanOrEqual(1)
    expect(cult.learned.m_jinlian).toBeGreaterThanOrEqual(1)
    expect(Math.max(cult.learned.m_taixuan!, cult.learned.m_jinlian!)).toBeLessThan(5)
  })

  it('归档一世履历、结算一遍即止:再次 confirm 应为空操作(防重复发放)', () => {
    const player = usePlayerStore()
    prepareReincarnation()
    confirmReincarnation(null)
    const lives = player.reincarnation.lives.length
    const fruit = player.reincarnation.daoFruit

    // 界面已关(view 置 null),守卫挡下
    confirmReincarnation(null)
    expect(player.reincarnation.lives).toHaveLength(lives)
    expect(player.reincarnation.daoFruit).toBe(fruit)
    expect(useUiStore().reincarnation).toBeNull()
  })

  it('逆旅契随世交割:归档进履历、本世契清空、下世不再受契约束', () => {
    const player = usePlayerStore()
    // seedLife 给 daoFruit=100,tr_gu 需 24
    expect(signLifeTrial('tr_gu')).toBe(true)
    expect(lifeTrialRules()).toBeDefined()

    prepareReincarnation()
    confirmReincarnation(null)

    // 先归档、后清空 —— 顺序错了会丢奖励或跨世泄漏
    const last = player.reincarnation.lives[player.reincarnation.lives.length - 1]
    expect(last?.trialId, '履历应记为这世所立之契').toBe('tr_gu')
    expect(player.reincarnation.trial, '本世契应随转世清空,不泄漏进下一世').toBeNull()
    expect(lifeTrialRules()).toBeUndefined()
  })
})
