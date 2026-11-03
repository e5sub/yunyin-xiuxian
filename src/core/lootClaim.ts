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
