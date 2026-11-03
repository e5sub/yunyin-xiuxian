/**
 * 掉落签发漏斗:登录走服务端(/api/loot/claim,数量与品质全在服务端裁决),
 * 未登录的离线单机走本地同一份裁决核心(lootGrant.grantEquips + 本地 rng),行为一致。
 *
 * 登录玩家请求失败时宁可不掉,也不本地补签 —— 本地生成的件没有台账,
 * 上传存档时会被「装备验源」移除,与其让玩家白高兴一场,不如这一件不掉。
 */
import type { EquipmentInstance } from '@/types'
import { rng } from '@/utils/random'
import { useAuthStore } from '@/stores/auth'
import { cloudApi } from '@/services/cloud'
import { grantEquips, type LootClaimCtx } from './lootGrant'
import { lootEnvFromActiveStores } from './profileRecompute'

/** 批量签发:ctxs 按序裁决,返回的实例按申请顺序拼接(调用方按序入包) */
export async function mintDrops(ctxs: readonly LootClaimCtx[]): Promise<EquipmentInstance[]> {
  if (ctxs.length === 0) return []
  const auth = useAuthStore()
  if (!auth.loggedIn) {
    const env = lootEnvFromActiveStores()
    if (!env) return []
    const out: EquipmentInstance[] = []
    for (const ctx of ctxs) out.push(...grantEquips(ctx, env, rng).equips)
    return out
  }
  try {
    const { equips } = await cloudApi.claimLoot({ claims: ctxs })
    return equips
  } catch {
    return []
  }
}

export type { LootClaimCtx } from './lootGrant'

/* ------------------------------------------------------------------ *
 * 法宝与器魂的签发(1.58.1)
 *
 * 与装备同一条漏斗:登录走服务端记台账,未登录放行(首传会把现有物件播种进台账),
 * 登录玩家请求失败时宁可不发 —— 无账之物上传时会被验源移除。
 * 放在本文件而不是另立模块:core 里 import store 的处数有硬基线(见 layeringAudit),
 * 同一件事没必要多开一个接线点。
 * ------------------------------------------------------------------ */
import type { SoulGain } from './lootGrant'

/** 批量签发法宝;返回服务端确认签发的那几件(顺序按申请) */
export async function mintArtifacts(defIds: readonly string[]): Promise<string[]> {
  if (defIds.length === 0) return []
  const auth = useAuthStore()
  if (!auth.loggedIn) return [...defIds]
  try {
    const { artifacts } = await cloudApi.claimLootExtras({ artifacts: [...defIds] })
    return artifacts
  } catch {
    return []
  }
}

/** 签发一枚器魂;true 表示可入档 */
export async function mintSoul(soul: SoulGain): Promise<boolean> {
  const auth = useAuthStore()
  if (!auth.loggedIn) return true
  try {
    const { souls } = await cloudApi.claimLootExtras({ souls: [soul] })
    return souls.includes(soul.uid)
  } catch {
    return false
  }
}
