/**
 * 存档分片与 store 的清单(唯一一份)。
 *
 * 客户端(engine 回补丁)、服务端的权威推进(advanceResolve)与动作结算(actionOps)
 * 都按这张表水合/回填 —— 三处各抄一份的话,新增分片时会有一处悄悄漏掉,
 * 表现为「该分片在服务端看不见」或「回传的补丁没人接」。
 *
 * 清单 = utils/storage 的 PERSISTED_STORES(17 片);ui 不持久化,不在内。
 */
import { useGameStore } from '@/stores/game'
import { usePlayerStore } from '@/stores/player'
import { useResourcesStore } from '@/stores/resources'
import { useInventoryStore } from '@/stores/inventory'
import { useCultivationStore } from '@/stores/cultivation'
import { useDongfuStore } from '@/stores/dongfu'
import { useAdventureStore } from '@/stores/adventure'
import { useQuestsStore } from '@/stores/quests'
import { useSettingsStore } from '@/stores/settings'
import { useLoadoutsStore } from '@/stores/loadouts'
import { useEndgameStore } from '@/stores/endgame'
import { useLoreStore } from '@/stores/lore'
import { useMarketStore } from '@/stores/market'
import { useApprenticeStore } from '@/stores/apprentice'
import { useBountyStore } from '@/stores/bounty'
import { usePacingTelemetry } from '@/stores/pacingTelemetry'
import { useDiagStore } from '@/stores/diag'

export type SliceStore = { $patch: (p: unknown) => void; $state: unknown }

/*
 * 工厂一律包一层 thunk(`() => useXStore()`)。
 * 这里与 store 之间有环(core ← store ← core),模块初始化时绑定可能还是 undefined;
 * 顶层数组一旦固化那个 undefined,后续调用就永远是 `factory is not a function`。
 * 包一层之后,每次调用才读 ESM 的 live binding —— 环解开时值已就位。
 */

export const SLICE_FACTORIES: readonly (readonly [string, () => SliceStore])[] = [
  ['game', () => useGameStore()],
  ['player', () => usePlayerStore()],
  ['resources', () => useResourcesStore()],
  ['inventory', () => useInventoryStore()],
  ['cultivation', () => useCultivationStore()],
  ['dongfu', () => useDongfuStore()],
  ['adventure', () => useAdventureStore()],
  ['quests', () => useQuestsStore()],
  ['settings', () => useSettingsStore()],
  ['loadouts', () => useLoadoutsStore()],
  ['endgame', () => useEndgameStore()],
  ['lore', () => useLoreStore()],
  ['market', () => useMarketStore()],
  ['apprentice', () => useApprenticeStore()],
  ['bounty', () => useBountyStore()],
  ['pacing', () => usePacingTelemetry()],
  ['diag', useDiagStore]
]

/** 分片 id → store 工厂(回补丁用) */
export function sliceStoreOf(id: string): SliceStore | undefined {
  const hit = SLICE_FACTORIES.find(([sid]) => sid === id)
  return hit === undefined ? undefined : hit[1]()
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 取整张存档的内存快照(JSON 深拷贝:$state 里全是可序列化数据) */
export function stateClone(): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {}
  for (const [id, factory] of SLICE_FACTORIES) {
    out[id] = JSON.parse(JSON.stringify(factory().$state)) as Record<string, unknown>
  }
  return out
}

/** 顶层键级 diff:值按 JSON 比较,嵌套结构整块给(与突破/上传 corrections 的口径一致) */
export function diffSlices(
  before: Record<string, Record<string, unknown>>,
  after: Record<string, Record<string, unknown>>,
  skip?: ReadonlySet<string>
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {}
  for (const id of Object.keys(before)) {
    const b = before[id]!
    const a = after[id]!
    const fields: Record<string, unknown> = {}
    for (const key of Object.keys(a)) {
      if (skip?.has(`${id}.${key}`) === true) continue
      if (JSON.stringify(b[key]) !== JSON.stringify(a[key])) fields[key] = a[key]
    }
    if (Object.keys(fields).length > 0) out[id] = fields
  }
  return out
}

/**
 * 水合噪声键:store 的 sanitize/默认值填充会在「什么都没做」时也改动若干键。
 * 空跑一次前后快照,把这些键挑出来,diff 时排除 —— 否则每次动作都会回传
 * 一堆与动作无关的字段,客户端白白 $patch 一遍,还会把噪声盖到真实值上。
 */
export function hydrationNoise(): Set<string> {
  const a = stateClone()
  const b = stateClone()
  const noise = new Set<string>()
  for (const id of Object.keys(a)) {
    const x = a[id]!
    const y = b[id]!
    for (const key of Object.keys(y)) {
      if (JSON.stringify(x[key]) !== JSON.stringify(y[key])) noise.add(`${id}.${key}`)
    }
  }
  return noise
}
