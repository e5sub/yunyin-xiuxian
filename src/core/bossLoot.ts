/**
 * 围妖击杀赏领取:领资粮 + 抽中装备时按自身境界生成入包。
 * BossView(进页即领)与托管巡检(自动领)共用同一条路,免得两处入账口径漂移。
 */
import { usePlayerStore } from '@/stores/player'
import { useResourcesStore } from '@/stores/resources'
import { cloudApi } from '@/services/cloud'
import { formatGN } from '@/utils/format'
import { acquireEquipment } from './loot'
import { mintDrops } from './lootClaim'
import { harvestMaterials } from './loreService'
import { stoneByTier } from './formulas'
import { tierOfMajor } from './secretRealm'

export interface BossLootClaim {
  /** 折算后的灵石文本(按自身境界) */
  stoneText: string
  herb: number
  /** 抽中装备时的入包行(自动收纳/化尘结论一并报出);未抽中为 null */
  equipLine: string | null
}

/** 在途领取:进页自动领、托管巡检与手点走同一条路,并发两路会各自按同一份 pending 入账(1.63.0) */
let claiming: Promise<BossLootClaim | null> | null = null

/**
 * 领取待领的击杀赏;无待领时返回 null(不发请求也行,但让服务端做唯一裁决更稳)。
 * 同一时刻只允许一条在途请求:并发调用拿到的是同一个 Promise,资源只加一次。
 */
export function claimBossLoot(): Promise<BossLootClaim | null> {
  if (claiming !== null) return claiming
  claiming = claimBossLootOnce().finally(() => {
    claiming = null
  })
  return claiming
}

async function claimBossLootOnce(): Promise<BossLootClaim | null> {
  const { pending } = await cloudApi.bossClaim()
  if (pending.stone <= 0 && pending.herb <= 0 && !pending.equip) return null
  const player = usePlayerStore()
  const resources = useResourcesStore()
  const tier = tierOfMajor(Math.max(0, player.major))
  const stone = stoneByTier(tier, pending.stone)
  resources.addStone(stone)
  resources.addSmall('herb', pending.herb)
  // 灵草照面入见闻(与历练/副本同一条归类口径,见 loreService 审计)
  harvestMaterials(tier, 'herb', pending.herb)
  let equipLine: string | null = null
  if (pending.equip) {
    // 精品起步(minQualityRank 1 会让品质窗口失效,与历练首领同规):高级装备要有高级的样子。
    // 实例由签发侧生成(tier 以服务端复算出的境界为准),本地不再掷
    const insts = await mintDrops([{ src: 'boss', tier }])
    equipLine = insts.length > 0 ? acquireEquipment(insts[0]!).line : null
  }
  return { stoneText: formatGN(stone), herb: pending.herb, equipLine }
}
