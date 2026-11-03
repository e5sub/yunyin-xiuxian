/**
 * 掉落签发核心:装备掉落的数量裁决与实例生成,单点共用。
 *
 * 服务端 /api/loot/claim 用它掷点 —— 客户端只报「在哪打」(来源/层级/场数),
 * 掉不掉、掉几件、品质窗口全由服务端按复算出的属性(env)裁决;
 * 未登录的离线单机也走同一份(本地 rng),行为与在线逐字段一致。
 *
 * 为什么装备不再由客户端生成:console 里一句
 *   S('inventory').items.push({...神品·40 阶·满词条...})
 * 形状完全合法,上传只被「阶数 ≤ 境界上限」钳一下 —— 一件「合法上限内的神装」从此进了档。
 * 掉落改为服务端签发后,行囊里每件装备的 uid 都出自服务端台账(见 server loot_ledger),
 * 上传存档时验源,非签发件移除并留痕。强化/重铸/词条转移原地改件(uid 不变),不受影响。
 *
 * 本模块会被打成 Node bundle 随镜像分发(package.json build:vendor),不得 import
 * 浏览器专属链路(services/cloud、DOM 组件);store 本身在无窗环境安全。
 */
import type { EquipmentInstance } from '@/types'
import type { RandomService } from '@/utils/random'
import { rng } from '@/utils/random'
import { generateEquipment } from './equipGen'
import { capChance } from './statsCalc'
import { EQUIP_DROP_CHANCE, EQUIP_DROP_CHANCE_CAP } from '@/data/constants'
import { maxTierForMajor } from '@/data/regions'
import { artifactDef } from '@/data/artifacts'
import { SOUL_GRADES, soulTypeDef } from '@/data/souls'
import { generateMarketStock, marketEquipInstance, marketSlotAt } from './marketService'
import { suppressionEquipmentLuck, SUPPRESS_EQUIP_LUCK_CAP } from './suppressLuck'

/** 掉落来源:与 /api/loot/claim 的裁决分支一一对应 */
export type LootSrc =
  | 'battle'    // 历练战斗胜利(afterWin)
  | 'boss'      // 围妖击杀赏(服务端已记 pending.equip,这里只生成实例)
  | 'secret'    // 秘境通关宝藏
  | 'event'     // 际遇/区域事件效果
  | 'dungeon'   // 副本妖物遗宝(服务端已裁决 win/equipDrop)
  | 'suppress'  // 镇压收益按小时期望
  | 'offline'   // 离线结算按期望件数
  | 'starter'   // 开局馈赠竹剑
  | 'market'    // 坊市货架(确定性再生,预览与购得同一物)

/** 一次掉落申请的上下文;数量与品质裁决所需的环境属性一律以服务端复算为准 */
export interface LootClaimCtx {
  src: LootSrc
  /** 区域/战场层级;服务端按境界上限钳制(starter 这类无层级来源可省,按 1 阶计) */
  tier?: number
  /** battle/offline:模式与区域事件的加丰 */
  rewardMult?: number
  /** battle:是否区域之主 */
  isBoss?: boolean
  /** offline:该场次的胜场数 */
  wins?: number
  /** suppress/offline:件数由调用方按各自的期望公式算好带来(镇守 0.4/时,离线 ≤6/场);
   *  服务端只按上限钳制再生成 —— 数量账本就在客户端侧,签发侧管的是「件件合法」 */
  count?: number
  /** suppress:开始镇守的时刻(运气随天数,服务端按 SUPPRESS_EQUIP_LUCK_CAP 封顶,坏值夹 0) */
  since?: number
  /** event/dungeon:品质下限;服务端夹进 [0,3](数据里际遇至多灵品起步,副本至多绝境良品) */
  minQualityRank?: number
  /** market:货架锚点与格号;服务端按同一套确定性再生,客户端报什么都不改货架 */
  stockedAt?: number
  idx?: number
}

/** 开局馈赠这类无层级来源的默认层级 */
const LOOT_DEFAULT_TIER = 1

/** 数量与品质裁决的环境属性;由档案复算(profileRecompute)从分片推出,客户端自报不作数 */
export interface LootEnv {
  major: number
  dropRate: number
  luck: number
  doubleDropRate: number
  /** 灵兽性格的掉落倾向(与 luck 相加,与在线 afterWin 同源) */
  petDropLuck: number
}

/** 事件/副本品质下限的合法上界:际遇数据至多灵品起步,副本绝境良品起步 */
export const LOOT_FLOOR_MAX = 3

/** 镇压单次签发件数上限(0.4/时 × 24 时 + 1 零头,再宽一格) */
export const SUPPRESS_COUNT_CAP = 12
/** 离线单次签发件数上限(与旧「最多生成 6 件」同值) */
export const OFFLINE_COUNT_CAP = 6

function clampFloor(rank: number | undefined): number {
  return Math.min(Math.max(Math.trunc(rank ?? 0), 0), LOOT_FLOOR_MAX)
}

/** 层级以服务端复算出的境界为准:客户端报多高都打不出境界外的层 */
function clampTier(tier: number, env: LootEnv): number {
  const cap = maxTierForMajor(env.major)
  return Math.min(Math.max(Math.trunc(tier), 1), cap)
}

/**
 * 按来源裁决一次掉落并生成实例。
 * rng 的消耗顺序与旧客户端逐处一致(战斗先掷翻倍再逐件),未登录路径行为不变。
 */
export function grantEquips(
  ctx: LootClaimCtx,
  env: LootEnv,
  service: RandomService = rng
): { equips: EquipmentInstance[]; overflow: number } {
  const tier = clampTier(ctx.tier ?? LOOT_DEFAULT_TIER, env)
  const luck = env.luck + env.petDropLuck
  const equips: EquipmentInstance[] = []
  const overflow = 0

  switch (ctx.src) {
    case 'battle': {
      const rewardMult = Math.min(Math.max(ctx.rewardMult ?? 1, 0.5), 4)
      const isBoss = Boolean(ctx.isBoss)
      const doubled = service.chance(capChance(env.doubleDropRate)) ? 2 : 1
      const chance = Math.min(EQUIP_DROP_CHANCE_CAP, EQUIP_DROP_CHANCE * rewardMult * (1 + env.dropRate) * (isBoss ? 2.5 : 1))
      for (let i = 0; i < doubled; i += 1) {
        if (service.chance(chance) || (isBoss && i === 0)) {
          // 普通战不传品质下限:传了(哪怕是 0)即「显式下限」,品质窗口失效,在线会比离线/审计多掉低阶高品。首领例外
          equips.push(generateEquipment(tier, service, isBoss ? { luck, minQualityRank: 1 } : { luck }))
        }
      }
      break
    }
    case 'boss':
      // 精品起步(minQualityRank 1 会让品质窗口失效,与历练首领同规):高级装备要有高级的样子
      equips.push(generateEquipment(tier, service, { minQualityRank: 1 }))
      break
    case 'secret':
      equips.push(generateEquipment(tier, service, { minQualityRank: 2 }))
      break
    case 'event': {
      const floor = clampFloor(ctx.minQualityRank)
      equips.push(generateEquipment(Math.max(tier, 1), service, floor > 0 ? { luck, minQualityRank: floor } : { luck }))
      break
    }
    case 'dungeon': {
      const floor = clampFloor(ctx.minQualityRank)
      equips.push(generateEquipment(tier, service, floor > 0 ? { minQualityRank: floor } : {}))
      break
    }
    case 'suppress': {
      // 件数由调用方按「0.4/时 × 时长,整数件直发、零头掷点」算好带来,签发侧只按上限钳;
      // 运气随镇守天数(与在线同源),封顶同客户端,坏值夹 0
      const count = Math.min(Math.max(Math.trunc(ctx.count ?? 0), 0), SUPPRESS_COUNT_CAP)
      const since = typeof ctx.since === 'number' && Number.isFinite(ctx.since) ? ctx.since : 0
      const tenureLuck = Math.min(suppressionEquipmentLuck(since, Date.now()), SUPPRESS_EQUIP_LUCK_CAP)
      for (let i = 0; i < count; i += 1) {
        // 不传品质下限:传了(哪怕是 0)品质窗口就失效,低阶高品更易出
        equips.push(generateEquipment(tier, service, { luck: tenureLuck }))
      }
      break
    }
    case 'offline': {
      // 与在线 afterWin 同源的期望计件在调用方算好(≤6/场,溢出折尘也在调用方);
      // 签发侧只管把这几件按合法层级与品质窗口生成
      const count = Math.min(Math.max(Math.trunc(ctx.count ?? 0), 0), OFFLINE_COUNT_CAP)
      for (let i = 0; i < count; i += 1) {
        equips.push(generateEquipment(tier, service, { luck }))
      }
      break
    }
    case 'starter':
      equips.push(generateEquipment(1, service, { slot: 'weapon' }))
      break
    case 'market': {
      // 货架确定性再生:预览与购得同一物,客户端报什么都不改货架(见 marketService 头注)
      const inst = marketSlotAt(env.major, ctx.stockedAt ?? 0, Math.trunc(ctx.idx ?? -1))
      if (inst) equips.push(marketEquipInstance(inst, ctx.stockedAt ?? 0))
      break
    }
  }

  return { equips, overflow }
}

/* ------------------------------------------------------------------ *
 * 法宝与器魂的签发(1.58.1)
 *
 * 这两类物件原先「有合法性、没来源」:法宝在档里是 `{ defId, level }`(同 defId 只一件),
 * 器魂虽有 uid 却由客户端 `refineSoul` 现生成 —— 一份手改存档就能把 49 件法宝全收齐、
 * 把顶阶器魂堆成山。这里补的仍是同一件事:**只签发数据表里确有其物的增益**,
 * 台账键法宝取 defId、器魂取 uid,上传时按 kind 分别验源(见 server/src/lootLedger.ts)。
 *
 * 判据不碰随机:法宝掉不掉、器魂凝出哪一阶,本来就在客户端掷(与装备不同,
 * 它们的「获得」由战斗/凝炼动作触发,不是掉落流程的一部分);这里只保证
 * 「这件东西真的存在,且确实有人为它买过单」。
 * ------------------------------------------------------------------ */
export interface SoulGain {
  uid: string
  type: string
  grade: number
}

export interface ExtraGains {
  artifacts: string[]
  souls: SoulGain[]
}

/** 单次签发允许的件数:一次战斗最多一件法宝、一次凝炼一枚器魂,32 是离线整段的余量 */
export const EXTRA_BATCH_MAX = 32

/** 校验并收口一次法宝/器魂签发申请(野 id、坏品阶一律丢弃,不报错) */
export function validateExtraGains(raw: unknown): ExtraGains {
  const out: ExtraGains = { artifacts: [], souls: [] }
  const body = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const maxGrade = SOUL_GRADES.length - 1
  // 先按 2 倍上限截原始数组(挡超大 body),校验后再收到 EXTRA_BATCH_MAX:
  // 野 id 与坏条目不该占掉合法件的名额
  for (const a of (Array.isArray(body.artifacts) ? body.artifacts : []).slice(0, EXTRA_BATCH_MAX * 2)) {
    if (out.artifacts.length >= EXTRA_BATCH_MAX) break
    if (typeof a === 'string' && artifactDef(a) !== undefined && !out.artifacts.includes(a)) out.artifacts.push(a)
  }
  for (const s of (Array.isArray(body.souls) ? body.souls : []).slice(0, EXTRA_BATCH_MAX * 2)) {
    if (out.souls.length >= EXTRA_BATCH_MAX) break
    if (typeof s !== 'object' || s === null) continue
    const o = s as Record<string, unknown>
    const uid = typeof o.uid === 'string' ? o.uid : ''
    const type = typeof o.type === 'string' ? o.type : ''
    // uid 进台账主键:限长,空串与超长一律不收
    if (uid === '' || uid.length > 64) continue
    if (soulTypeDef(type as never) === undefined) continue
    const grade = typeof o.grade === 'number' && Number.isFinite(o.grade) ? Math.trunc(o.grade) : 0
    out.souls.push({ uid, type, grade: Math.max(0, Math.min(maxGrade, grade)) })
  }
  return out
}

/* ------------------------------------------------------------------ *
 * 坊市定价(1.58.1)
 *
 * 货架内容早就由 (major, stockedAt) 确定性再生,但**价格**只在客户端用过 ——
 * 于是「白拿」只需把扣款那几行删掉。这里把某一格的价格也交出来,
 * 服务端据此记账(server/src/marketLedger),存档上传时把该付的钱从增量里扣掉。
 * 格号不存在/非货格返回 null(与 marketSlotAt 同口径)。
 * ------------------------------------------------------------------ */
export interface MarketPrice {
  m: number
  e: number
  /** 该格是不是装备(装备要另外走签发,丹药/材料直接入账) */
  equipment: boolean
  tier: number
}

export function marketPriceAt(major: number, stockedAt: number, idx: number): MarketPrice | null {
  if (!Number.isFinite(stockedAt) || stockedAt <= 0 || !Number.isInteger(idx) || idx < 0) return null
  const shelf = generateMarketStock(major, stockedAt)
  const slot = shelf.goods.find(s => s.idx === idx)
  if (slot === undefined || slot.sold) return null
  const price = slot.price
  if (typeof price !== 'object' || price === null) return null
  const m = typeof price.m === 'number' && Number.isFinite(price.m) ? price.m : 0
  const e = typeof price.e === 'number' && Number.isFinite(price.e) ? price.e : 0
  if (m <= 0 && e <= 0) return null
  return { m, e, equipment: slot.kind === 'equipment', tier: slot.kind === 'equipment' ? slot.tier : 0 }
}
