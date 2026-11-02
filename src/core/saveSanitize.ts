/**
 * 存档分片的字段级归一化 —— 客户端读档自愈与服务端落库前审计的同一份实现。
 *
 * 为什么要有这个模块:
 *   服务端此前只校验「version / 有没有 data / 大小 / 是否开局」,存档内容照单全收。
 *   于是 console 改 store(或直接改包)能让装备 tier/level/词条、功法等级、境界、
 *   灵石指数随便写 —— 属性复算(profileRecompute)只保证「属性从分片重推」,
 *   分片本身离谱照样推出离谱属性:一件词条塞满、强化到 999 的装备依然是「合法分片」。
 *
 * 做法:
 *   复用客户端每个 store 已经写好、已被大量 spec 覆盖的 sanitize(),
 *   服务端把上传的分片无头水合进同一批 store,跑一遍,再把修过的状态读回来。
 *   判据只有一份,不存在「服务端规则与客户端规则各说各话」的漂移。
 *
 * 边界:
 *   - 只清理「结构上不可能」的东西(野 id / 超上限 / NaN / 坏大数指数),
 *     不判断数值「合不合理」—— 那属于账本审计,见 server 侧的境界跳变留痕。
 *   - 只回写输入里出现过的键:存档里没有的分片不凭空造,sanitize 期间新加的键也不带出去,
 *     免得把服务端的默认态灌进玩家档。
 *   - Node 下运行(服务端 tsx),不得 import 浏览器专属链路;
 *     故不含 auth(会话态,本来就不进存档),其余 store 在无窗环境安全。
 */
import { createPinia, setActivePinia } from 'pinia'
import { migrateHerbSlice, migrateInventorySlice, PERSISTED_STORES } from '@/utils/storage'
import { equipLevelCap } from '@/core/forge'
import { expRequirement } from '@/core/formulas'
import { qualityDef } from '@/data/qualities'
import { HERB_GRADES, type HerbGrade } from '@/data/herbGrades'
import { gt, mulN } from '@/utils/gnum'
import { usePlayerStore } from '@/stores/player'
import { useResourcesStore } from '@/stores/resources'
import { useLoreStore } from '@/stores/lore'
import { useDongfuStore } from '@/stores/dongfu'
import { useCultivationStore } from '@/stores/cultivation'
import { useInventoryStore } from '@/stores/inventory'
import { useQuestsStore } from '@/stores/quests'
import { useAdventureStore } from '@/stores/adventure'
import { useEndgameStore } from '@/stores/endgame'
import { useLoadoutsStore } from '@/stores/loadouts'
import { useSettingsStore } from '@/stores/settings'
import { useGameStore } from '@/stores/game'
import { useDiagStore } from '@/stores/diag'
import { useMarketStore } from '@/stores/market'
import { useApprenticeStore } from '@/stores/apprentice'
import { useBountyStore } from '@/stores/bounty'
import { usePacingTelemetry } from '@/stores/pacingTelemetry'

/** sanitize 的最小形态:各 store 都提供,顺序敏感(见下) */
interface StoreLike {
  $state: Record<string, unknown>
  $patch: (partial: Record<string, unknown>) => void
  sanitize: () => void
}

interface SliceStep {
  /** 存档分片键(与 PERSISTED_STORES 一致;store id 可能不同,如 pacing) */
  slice: string
  /** 取 store 实例;17 个 store 的类型各不相同,细节按 StoreLike 收口 */
  use: () => { sanitize: () => void }
}

/**
 * 修仓顺序只此一份 —— 与客户端读档后的 sanitizeAll 同序。
 * 顺序有意义:后者可能读前者的状态(如 adventure 的解锁闭包、inventory 的装备门槛),
 * 先水合全部再统一 sanitize,与浏览器里 pinia 持久化插件的行为一致。
 */
export const SAVE_SANITIZE_STEPS: readonly SliceStep[] = [
  { slice: 'player', use: usePlayerStore },
  { slice: 'resources', use: useResourcesStore },
  { slice: 'lore', use: useLoreStore },
  { slice: 'dongfu', use: useDongfuStore },
  { slice: 'cultivation', use: useCultivationStore },
  { slice: 'inventory', use: useInventoryStore },
  { slice: 'quests', use: useQuestsStore },
  { slice: 'adventure', use: useAdventureStore },
  { slice: 'endgame', use: useEndgameStore },
  { slice: 'loadouts', use: useLoadoutsStore },
  { slice: 'settings', use: useSettingsStore },
  { slice: 'game', use: useGameStore },
  { slice: 'diag', use: useDiagStore },
  { slice: 'market', use: useMarketStore },
  { slice: 'apprentice', use: useApprenticeStore },
  { slice: 'bounty', use: useBountyStore },
  { slice: 'pacing', use: usePacingTelemetry }
]

export interface SanitizeReport {
  /** 归一化后的分片;键只取自输入,不会多出输入里没有的分片 */
  data: Record<string, unknown>
  /** 与输入不一致的分片名(审计摘要用) */
  touched: string[]
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 旧档形状迁移:与客户端 applySavePayload 同一条链(灵草分品、多法宝位) */
function migrateSlice(slice: string, value: Record<string, unknown>): Record<string, unknown> {
  if (slice === 'resources') return migrateHerbSlice(value)
  if (slice === 'inventory') return migrateInventorySlice(value)
  return value
}

/** 读回:只取输入里出现过的键,且该键确实是 state(排除 computed / 方法) */
function readBack(store: StoreLike, keys: readonly string[]): Record<string, unknown> {
  const state = store.$state
  const out: Record<string, unknown> = {}
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(state, key)) continue
    out[key] = state[key]
  }
  return out
}

/** 分片是否有实质变化(比较序列化结果;存档本来就是 JSON,这判据足够) */
function changed(before: unknown, after: unknown): boolean {
  return JSON.stringify(before) !== JSON.stringify(after)
}

/**
 * 数值层面的护栏:只管「不可能合法」的量级,不判断收支是否合理。
 *
 * 存档的 GNum 指数界是 ±999(见 saveShape),那只是拦坏档 —— 结果 `exp: {m:1,e:500}`、
 * 灵石 e=1e8 这类「格式合法、数量离谱」的值照样进库。其中修为最要命:
 * 修为是突破的唯一燃料,写个 e500 进去,点几下突破就能直达终局。
 *
 * 判据都取「玩法链自身算得出来的量」再放大若干倍:
 *  - 修为 ≤ 本境界突破所需 × EXP_HOARD_LIMIT(正常玩家不会囤到 100 倍于突破门槛);
 *  - 灵石指数 ≤ 150(真仙终局实测 ≈e80,与 profiles 快照同一把尺);
 *  - 灵草每品 / 杂项资源 ≤ 1e9(掉落以个位、十位计,十亿株要千万次历练)。
 */
const EXP_HOARD_LIMIT = 100
const SMALL_RESOURCE_MAX = 1e9
const SPIRIT_STONE_EXP_MAX = 150

function tightenVitals(): void {
  const player = usePlayerStore()
  if (gt(player.exp, mulN(expRequirement(player.major, player.sub), EXP_HOARD_LIMIT))) {
    player.exp = mulN(expRequirement(player.major, player.sub), EXP_HOARD_LIMIT)
  }
  const resources = useResourcesStore()
  if (resources.spiritStone.e > SPIRIT_STONE_EXP_MAX) {
    resources.spiritStone = { m: 9.99, e: SPIRIT_STONE_EXP_MAX }
  }
  for (const key of ['qi', 'wudao', 'ore', 'page', 'dust'] as const) {
    if (resources[key] > SMALL_RESOURCE_MAX) resources[key] = SMALL_RESOURCE_MAX
  }
  const herbs: Record<HerbGrade, number> = { ...resources.herbByGrade }
  let herbFixed = false
  for (const g of HERB_GRADES) {
    if (herbs[g] > SMALL_RESOURCE_MAX) {
      herbs[g] = SMALL_RESOURCE_MAX
      herbFixed = true
    }
  }
  if (herbFixed) resources.herbByGrade = herbs
}

/**
 * sanitize 之后的二次收口:判据取自玩法链本身,而不是「宽到不误伤」的修档上限。
 *
 *  - 强化等级 ≤ equipLevelCap():修档上限按「满建筑加成」算,改包写 25 级、洞府却只有
 *    三级炼器台时照样放行,而 resolveEquipStats 是直接按 level 算属性的 —— 这里按实际建筑钳回。
 *  - 词条条数 ≤ 该品质上限:修档只夹到 EQUIP_AFFIX_HARD_CAP(16),可凡品上限只有 1 条,
 *    塞满 16 条等于白送 15 条词条。
 *
 * 两处都是「不可能合法」的下修,不涉及数值合理性的判断(那属于账本审计)。
 */
function tightenEquipped(): void {
  const inventory = useInventoryStore()
  const cap = equipLevelCap()
  inventory.items = inventory.items.map(it => {
    const affixes = it.affixes.slice(0, Math.max(0, qualityDef(it.quality).affixes[1]))
    const level = Math.min(it.level, cap)
    if (level === it.level && affixes.length === it.affixes.length) return it
    return {
      ...it,
      level,
      affixes,
      // 已封词的集合只保留还活着的词条,否则重铸界面会显示已不存在的封条
      sealedAffixIds: it.sealedAffixIds?.filter(id => affixes.some(a => a.id === id))
    }
  })
}

/**
 * 归一化一份存档的 data 段。
 *
 * @returns 归一化结果与改动摘要;`data` 不是对象时返回 null(调用方按原样拒绝或跳过)。
 *   `data` 里的分片若不在 PERSISTED_STORES 内,原样保留 —— 服务端不做「删别人字段」的决定。
 */
export function sanitizeSaveSlices(data: unknown): SanitizeReport | null {
  if (!isPlainObject(data)) return null

  // 先按已有分片做形状迁移(纯函数,不碰 store),再水合
  const input: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    input[key] = PERSISTED_STORES.includes(key as never) && isPlainObject(value)
      ? migrateSlice(key, value)
      : value
  }

  const pinia = createPinia()
  setActivePinia(pinia)
  try {
    // 第一遍:全部水合(缺片/坏形按空对象跳过,store 保持默认态)
    const live: { slice: string; store: StoreLike; keys: string[] }[] = []
    for (const step of SAVE_SANITIZE_STEPS) {
      const slice = input[step.slice]
      if (!isPlainObject(slice)) continue
      const store = step.use() as unknown as StoreLike
      store.$patch(slice as never)
      live.push({ slice: step.slice, store, keys: Object.keys(slice) })
    }
    // 第二遍:统一修形(与 sanitizeAll 同序)
    for (const step of SAVE_SANITIZE_STEPS) {
      const entry = live.find(x => x.slice === step.slice)
      if (entry) entry.store.sanitize()
    }
    // 第三遍:按玩法链判据收口(没有对应分片就不必建 store)
    if (live.some(x => x.slice === 'inventory')) tightenEquipped()
    if (live.some(x => x.slice === 'player' || x.slice === 'resources')) tightenVitals()
    const out: Record<string, unknown> = {}
    const touched: string[] = []
    for (const [key, value] of Object.entries(input)) {
      const entry = live.find(x => x.slice === key)
      if (!entry) {
        out[key] = value
        continue
      }
      const fixed = readBack(entry.store, entry.keys)
      // 没改动就写回原值:合法档不该因「水合再序列化」发生任何字节变化
      // (键顺序、数字精度、对象原型都会跟着变,既平白放大存档 diff,也会让玩家看到无谓的档变更)
      if (changed(value, fixed)) {
        out[key] = fixed
        touched.push(key)
      } else {
        out[key] = value
      }
    }
    return { data: out, touched }
  } catch {
    // 链路抛错(极端畸形分片):调用方按「未归一化」处理,不阻断存档
    return null
  } finally {
    setActivePinia(undefined)
  }
}
