import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { usePlayerStore } from '@/stores/player'
import { formatGN } from '@/utils/format'
import { buffDef } from '@/data/buffs'
import { CULT_BASE_SPEED, CULT_SPEED_SOFT_CAP_T } from '@/data/constants'
import { baseCultPerSec } from './formulas'
import { retreatGainText, retreatGainedText, checkStateAchievements, retreatMarginalSpeed } from './progress'
import { useQuestsStore } from '@/stores/quests'

/** 闭关预览「约多得修为 X」:与修炼行同读 baseCultPerSec,时长与加成取自 buffs.ts 的 retreat 本体 */
describe('retreatGainText 闭关约多得预览', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('炼气初成:值 = CULT_BASE_SPEED ×1.5×300(写死算一遍,不镜像实现)', () => {
    const player = usePlayerStore()
    expect(baseCultPerSec(player.major, player.sub)).toBeCloseTo(CULT_BASE_SPEED, 6)
    const expected = CULT_BASE_SPEED * 1.5 * 300 // 585
    expect(retreatGainText()).toBe(`约多得修为 ${formatGN(expected)}`)
  })

  it('加成翻倍 → 预览翻倍(buff 本体改,这里的数也线性跟)', () => {
    const player = usePlayerStore()
    const baseline = baseCultPerSec(player.major, player.sub)

    const def = buffDef('retreat')!
    const boost = def.mods.cultivationSpeed ?? 0
    const expected = baseline * boost * def.durationSec
    expect(retreatGainText()).toBe(`约多得修为 ${formatGN(expected)}`)

    const doubled = baseline * (boost * 2) * def.durationSec
    expect(formatGN(doubled)).toBe(formatGN(expected * 2))
  })

  it('境界抬升 → 预览随 base 抬升(非写死一个数)', () => {
    const player = usePlayerStore()
    const lo = baseCultPerSec(player.major, player.sub)
    player.major = 2
    const hi = baseCultPerSec(player.major, player.sub)
    expect(hi).toBeGreaterThan(lo)
    expect(retreatGainText()).toBe(`约多得修为 ${formatGN(hi * 1.5 * 300)}`)
  })

  it('闭关中的活数:过半 → 恰为全长的一半(同一速率,只差已走时长)', () => {
    const player = usePlayerStore()
    const perSec = baseCultPerSec(player.major, player.sub) * 1.5
    const half = perSec * 150
    const full = perSec * 300
    expect(retreatGainedText(150)).toBe(`已多得修为 ${formatGN(half)}`)
    expect(full).toBeCloseTo(half * 2, 6)
  })

  it('闭关中的活数:未起步(0 秒)→ 空白,不报「已多得 0」', () => {
    expect(retreatGainedText(0)).toBe('')
  })
})

/**
 * 成就周期补扫:realm/counter 成就只在 track()/trackRealm() 时求值;
 * checkStateAchievements 须重放 checkAchievements,老档/导入档越境后低境界成就才会解锁。
 */
describe('成就周期补扫应治愈「越境未解锁」', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('境界已拉高、从未 track 过,checkStateAchievements 也应补发低境界成就', () => {
    const player = usePlayerStore()
    const quests = useQuestsStore()
    player.$patch({ major: 12 })
    expect(quests.hasAchieved('a_r1'), '前置于未补扫时应是锁着的(红->绿)').toBe(false)
    checkStateAchievements()
    expect(quests.hasAchieved('a_r1'), '筑基境成就应被周期补扫解锁').toBe(true)
    expect(quests.hasAchieved('a_r5'), '炼虚境成就应补发').toBe(true)
    expect(quests.hasAchieved('a_r9'), '渡劫/真仙成就应补发').toBe(true)
    expect(quests.hasAchieved('a_r12'), '太乙境成就应补发').toBe(true)
  })
})

describe('主线任务同根补扫也应推进', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('境界已过出生任务、未再 track,checkStateAchievements 也应推进主线', () => {
    const player = usePlayerStore()
    const quests = useQuestsStore()
    expect(quests.mainIdx).toBe(0)
    player.$patch({ major: 1 }) // 出生任务 realm_0_2(炼气二层)已满足
    checkStateAchievements()
    expect(quests.mainIdx, '出生任务应被补扫完成并把主线前推一步').toBe(1)
  })
})

describe('retreatMarginalSpeed 闭关边际(修炼速度软上限)', () => {
  it('低于阈:按全额加成报(预览与修炼行同口径)', () => {
    expect(retreatMarginalSpeed(0, 1.5)).toBeCloseTo(1.5, 6)
    expect(retreatMarginalSpeed(1.0, 1.5)).toBeCloseTo(1.5, 6)
  })

  it('越阈:越出部分按 CULT_SPEED_SOFT_CAP_DIMINISH 折算,不再全按 1.5 报', () => {
    // 5.9 反解无封顶 = 6.8;+1.5 = 8.3;再封 = 6.65;净增量 = 0.75
    expect(retreatMarginalSpeed(5.9, 1.5)).toBeCloseTo(0.75, 6)
    // 恰在阈上:1.5 全按半价
    expect(retreatMarginalSpeed(CULT_SPEED_SOFT_CAP_T, 1.5)).toBeCloseTo(0.75, 6)
  })
})
