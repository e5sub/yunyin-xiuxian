/**
 * 掉落签发核心判据(1.58.0):数量与品质的裁决边界,客户端离线与服务器共用这一份。
 * 故障注入:clampTier 抬境界 / count 超上限 / 事件下限越权,分别钉三条边。
 */
import { describe, expect, it } from 'vitest'
import { grantEquips, LOOT_FLOOR_MAX, OFFLINE_COUNT_CAP, SUPPRESS_COUNT_CAP, type LootEnv } from './lootGrant'
import { maxTierForMajor } from '@/data/regions'
import { qualityDef } from '@/data/qualities'
import { generateMarketStock } from '@/core/marketService'
import { RandomService } from '@/utils/random'
import { usePlayerStore } from '@/stores/player'
import { useInventoryStore } from '@/stores/inventory'
import { setActivePinia, createPinia } from 'pinia'

const ENV: LootEnv = { major: 0, dropRate: 0, luck: 0, doubleDropRate: 0, petDropLuck: 0 }

describe('掉落签发 · 数量与品质的边界', () => {
  it('battle:首领战必掉且精品起步;普通战可在封顶概率内连掉', () => {
    const boss = grantEquips({ src: 'battle', tier: 1, isBoss: true }, ENV, new RandomService(() => 0.99))
    expect(boss.equips.length, '首领第一件必掉(isBoss && i === 0)').toBe(1)
    expect(qualityDef(boss.equips[0]!.quality).rank, '首领起步不低于良品(minQualityRank 1)').toBeGreaterThanOrEqual(1)

    const lucky = grantEquips(
      { src: 'battle', tier: 1, rewardMult: 4 },
      { ...ENV, dropRate: 3, doubleDropRate: 3 },
      new RandomService(() => 0)
    )
    expect(lucky.equips.length, '掉率与翻倍都封顶内,至多两件').toBe(2)
  })

  it('层级按境界钳:客户端报天上去的 tier,打不出境界外的层', () => {
    const cap = maxTierForMajor(0)
    const out = grantEquips({ src: 'battle', tier: 999 }, ENV, new RandomService(() => 0))
    expect(out.equips.length).toBeGreaterThan(0)
    for (const inst of out.equips) expect(inst.tier, `零境至多 ${cap} 阶`).toBeLessThanOrEqual(cap)
  })

  it('event/dungeon 品质下限夹进合法区间:报多大都越不过 LOOT_FLOOR_MAX', () => {
    expect(LOOT_FLOOR_MAX).toBe(3)
    const out = grantEquips(
      { src: 'event', tier: 2, minQualityRank: 99 },
      ENV,
      new RandomService(() => 0)
    )
    expect(qualityDef(out.equips[0]!.quality).rank, '际遇下限越权被钳到 3(灵品)').toBeGreaterThanOrEqual(LOOT_FLOOR_MAX)
  })

  it('offline/suppress 件数按上限钳:报多少都不超 OFFLINE_COUNT_CAP / SUPPRESS_COUNT_CAP', () => {
    expect(OFFLINE_COUNT_CAP).toBe(6)
    expect(SUPPRESS_COUNT_CAP).toBe(12)
    const offline = grantEquips({ src: 'offline', tier: 3, count: 999 }, ENV, new RandomService(() => 0))
    expect(offline.equips.length).toBe(OFFLINE_COUNT_CAP)
    const suppress = grantEquips({ src: 'suppress', tier: 3, count: 999 }, ENV, new RandomService(() => 0))
    expect(suppress.equips.length).toBe(SUPPRESS_COUNT_CAP)
  })

  it('market:按 (major, stockedAt, idx) 确定性再生,格号不存在/非装备格不发', () => {
    // 挑一个整架里有装备的锚点(货架门类随锚点掷点,不是每个锚点都进装备)
    const stockedAt = [1_700_000_000_000, 1_700_000_060_000, 1_700_000_120_000, 1_700_000_180_000].find(
      t => generateMarketStock(6, t).goods.some(s => s.kind === 'equipment')
    )!
    // 用真实再生货架上的装备格:0 号格不必然是装备
    const equipIdx = generateMarketStock(6, stockedAt).goods.find(s => s.kind === 'equipment')!.idx
    const out = grantEquips({ src: 'market', stockedAt, idx: equipIdx }, { ...ENV, major: 6 }, new RandomService(() => 0))
    expect(out.equips.length, '装备格必签发同锚同件').toBeGreaterThan(0)
    // 同锚再生是同一件(模板/品质一致;uid 是签发侧另配)
    const again = grantEquips({ src: 'market', stockedAt, idx: equipIdx }, { ...ENV, major: 6 }, new RandomService(() => 0))
    expect(again.equips[0]!.templateId).toBe(out.equips[0]!.templateId)
    expect(again.equips[0]!.quality).toBe(out.equips[0]!.quality)
    // 非装备格不发
    const matIdx = generateMarketStock(6, stockedAt).goods.find(s => s.kind !== 'equipment')!.idx
    expect(grantEquips({ src: 'market', stockedAt, idx: matIdx }, { ...ENV, major: 6 }, new RandomService(() => 0)).equips, '丹材格不签发装备').toHaveLength(0)
  })

  it('starter:开局竹剑 1 阶武器,未登录路径与在线同一份判据', () => {
    setActivePinia(createPinia())
    const out = grantEquips({ src: 'starter' }, ENV, new RandomService(() => 0))
    expect(out.equips[0]!.tier).toBe(1)
    expect(out.equips[0]!.templateId).toContain('w_')
  })

  it('行囊里 uid 唯一:签发侧出的件不会自相撞号', () => {
    setActivePinia(createPinia())
    usePlayerStore().initCharacter('签发司', { roots: [] } as never)
    const inventory = useInventoryStore()
    const uids = new Set<string>()
    for (let i = 0; i < 20; i += 1) {
      const out = grantEquips({ src: 'battle', tier: 1, isBoss: true }, ENV, new RandomService(() => 0))
      for (const inst of out.equips) {
        expect(uids.has(inst.uid), `uid 重复:${inst.uid}`).toBe(false)
        uids.add(inst.uid)
        expect(inventory.addEquipment(inst), '入包须成功(行囊足够大)').toBe(true)
      }
    }
  })
})
