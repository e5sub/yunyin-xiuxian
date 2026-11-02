/**
 * 档案快照的单一计算点:客户端上传用、服务端复算用,走同一份 finalStats 链。
 *
 * 背景:快照(hp/atk/def/power)原先由客户端算好随档上传,服务端只做数值钳制 ——
 * console 改 store 或改包上传即可把属性抬到天上,污染围妖/副本/擂台/排行榜。
 * 现把「从存档分片到属性」这段计算收进一个模块:
 *   客户端 buildProfileSnapshot 从已激活的 store 取(与旧实现同口径);
 *   服务端 PUT /save 用上传的分片无头水合同一批 store、跑同一份 computeFinalStats 复算,
 *   复算成功以服务端为准,失败(分片畸形/链路抛错)回落到旧的钳制快照。
 *
 * 注意:本模块在 Node 下运行(服务端 tsx),不得 import 浏览器专属链路
 * (services/cloud 的 import.meta.env、DOM 组件等);store 本身在无窗环境安全。
 */
import { createPinia, setActivePinia } from 'pinia'
import { usePlayerStore } from '@/stores/player'
import { useInventoryStore } from '@/stores/inventory'
import { useCultivationStore } from '@/stores/cultivation'
import { useDongfuStore } from '@/stores/dongfu'
import { useResourcesStore } from '@/stores/resources'
import { realmLabel } from '@/data/realms'
import { powerScore } from '@/core/formulas'

/** 与云端上传的 profile 字段一一对应(services/cloud.ts putSave 的 payload) */
export interface ProfileSnapshot {
  name: string
  realmLabel: string
  realmIndex: number
  powerM: number
  powerE: number
  hpM: number
  hpE: number
  atkM: number
  atkE: number
  defM: number
  defE: number
}

function finite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n)
}

/** finalStats 链路读取的全部 store 分片;缺片的按空对象水合(computed 走默认态) */
const SLICE_IDS = ['player', 'inventory', 'cultivation', 'dongfu', 'resources'] as const

function asSlices(data: unknown): Record<string, Record<string, unknown>> | null {
  if (typeof data !== 'object' || data === null) return null
  const raw = data as Record<string, unknown>
  const out: Record<string, Record<string, unknown>> = {}
  for (const id of SLICE_IDS) {
    const slice = raw[id]
    out[id] = typeof slice === 'object' && slice !== null && !Array.isArray(slice)
      ? (slice as Record<string, unknown>)
      : {}
  }
  // 角色分片必须有 major/sub 可读,否则境界都没法定,复算无从谈起
  const player = out.player!
  if (!finite(player.major) || !finite(player.sub)) return null
  return out
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 从「当前已激活的 store」直接取快照;链路任何一环产出非有限值即 null(调用方回落) */
export function snapshotFromActiveStores(): ProfileSnapshot | null {
  const player = usePlayerStore()
  const { attack, defense, maxHp } = player.finalStats
  const power = powerScore(attack, defense, maxHp)
  const nums = [attack.m, attack.e, defense.m, defense.e, maxHp.m, maxHp.e, power.m, power.e]
  if (!nums.every(finite)) return null
  if (!finite(player.major) || !finite(player.sub)) return null
  return {
    name: typeof player.name === 'string' ? player.name.slice(0, 24) : '',
    realmLabel: realmLabel(Math.max(0, Math.trunc(player.major)), Math.max(0, Math.trunc(player.sub))),
    realmIndex: Math.trunc(player.major) * 100 + Math.trunc(player.sub),
    powerM: power.m,
    powerE: power.e,
    hpM: maxHp.m,
    hpE: maxHp.e,
    atkM: attack.m,
    atkE: attack.e,
    defM: defense.m,
    defE: defense.e
  }
}

/**
 * 从云档分片无头复算(服务端走这条):临时 pinia 水合 → 同一套 finalStats。
 * 客户端算什么它就算什么 —— 存档里就算被塞了 attack: 1e999 这类字段也不读,
 * 属性一律由装备/功法/洞府等分片重推。链路抛错或结果非有限值返回 null。
 */
export function snapshotFromSlices(data: unknown): ProfileSnapshot | null {
  const slices = asSlices(data)
  if (slices === null) return null
  const pinia = createPinia()
  setActivePinia(pinia)
  try {
    usePlayerStore().$patch(slices.player!)
    if (isPlainObject(slices.inventory)) useInventoryStore().$patch(slices.inventory)
    if (isPlainObject(slices.cultivation)) useCultivationStore().$patch(slices.cultivation)
    if (isPlainObject(slices.dongfu)) useDongfuStore().$patch(slices.dongfu)
    if (isPlainObject(slices.resources)) useResourcesStore().$patch(slices.resources)
    return snapshotFromActiveStores()
  } catch {
    return null
  } finally {
    setActivePinia(undefined)
  }
}
