/**
 * 掉落签发裁决:动态加载客户端共享模块 core/lootGrant,
 * 按来源(历练/围妖/秘境/际遇/副本/镇压/离线/开局/坊市)裁决数量并生成实例。
 *
 * 与 recompute/saveNormalize/saveAuthority 同样走动态 import:客户端模块用 `@/` 别名,
 * 服务端 tsc 不跟随;运行时生产环境吃 server/vendor bundle(clientVendor.ts)。
 * 加载失败按 null 处理,调用方对玩家回「本次没掉落」—— 装备宁可不发,不可无账可查。
 */
import { loadClientModule } from './clientVendor.js'

const SOURCE_MODULE = '../../src/core/lootGrant'
const VENDOR_FILE = 'lootGrant'

export interface LootGrantResult {
  equips: Array<Record<string, unknown>>
  overflow: number
}

type GrantFn = (ctx: unknown, env: unknown, rng?: unknown) => LootGrantResult | null

let cached: Promise<{ grantEquips: GrantFn }> | null = null

function clientGrant(): Promise<{ grantEquips: GrantFn }> {
  cached ??= loadClientModule<{ grantEquips: GrantFn }>(SOURCE_MODULE, VENDOR_FILE)
  return cached
}

/** 裁决一次掉落;失败返回 null(调用方按「没掉落」处理) */
export async function grantLoot(ctx: unknown, env: unknown): Promise<LootGrantResult | null> {
  try {
    const mod = await clientGrant()
    return mod.grantEquips(ctx, env)
  } catch (err) {
    console.warn('[loot] 掉落裁决失败,按没掉落处理:', err instanceof Error ? err.message : err)
    return null
  }
}
