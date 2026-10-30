/**
 * 存档上云:登录后定时把本地分片推到服务器,登录/启动时拉取云端档覆盖本地。
 * 本地 localStorage 降级为缓存;服务器为权威副本。
 * 云端应用与本地导入走同一条校验/迁移/原子写盘链路(core/save.applySavePayload)。
 *
 * 防丢档的三道闸:
 * 1. 每次上传带 baseUpdatedAt(上次对齐到的云端时间戳),服务端发现被别的设备写过就回 409,本机停止上传而不是覆盖;
 * 2. 上传失败/冲突不再静默,状态进 syncState,设置页可见、次数够就弹提示;
 * 3. 云端存档应用失败时不进空档流程(否则开局 20 秒后空档会把云端原档推平)。
 */
import { ref } from 'vue'
import { buildExportPayload, SAVE_VERSION, storageKey } from '@/utils/storage'
import { readSaveText } from '@/utils/crypto'
import { realmLabel } from '@/data/realms'
import { powerScore } from '@/core/formulas'
import { applySavePayload, reloadGame } from '@/core/save'
import { CloudError, cloudApi } from '@/services/cloud'
import { useAuthStore } from '@/stores/auth'
import { useGameStore } from '@/stores/game'
import { usePlayerStore } from '@/stores/player'

/** 自动上传间隔:登录时从服务端 game_config(save_push_interval_sec)取,GM 后台可调 */
let pushIntervalMs = 20_000

/** 同步锚点:本机上次对齐到的云端 updatedAt。独立键,不进 PERSISTED_STORES(清档不该清掉它) */
const SYNC_META_KEY = 'yunyin.syncMeta'

/** 手动上传成功后解除冲突封锁 */
export type SyncState = 'idle' | 'ok' | 'error' | 'conflict'

export const syncState = ref<SyncState>('idle')
export const syncErrorText = ref('')
export const lastSyncAt = ref(0)
/** 一次性提示:core 不直接依赖 ui store,由界面层订阅后弹 toast(每次新建对象,相同文案也会触发) */
export const syncNotice = ref<{ text: string; at: number } | null>(null)

/** 冲突后停止自动上传,避免继续覆盖云端;玩家手动上传或拉取成功后解除 */
let blocked = false
let failStreak = 0

function readBase(): number {
  try {
    const raw = localStorage.getItem(SYNC_META_KEY)
    if (raw === null) return 0
    const meta = JSON.parse(raw) as { baseUpdatedAt?: unknown }
    return typeof meta.baseUpdatedAt === 'number' && Number.isFinite(meta.baseUpdatedAt) ? meta.baseUpdatedAt : 0
  } catch {
    return 0
  }
}

function writeBase(value: number): void {
  try {
    localStorage.setItem(SYNC_META_KEY, JSON.stringify({ baseUpdatedAt: value }))
  } catch {
    // 存储不可用:下次启动按 base=0 处理,会重新拉云端(方向是安全的)
  }
}

/** 本机是否已和云端对齐过(0 = 从未对齐,云端为权威) */
export function cloudAligned(): boolean {
  return readBase() > 0
}

function report(kind: 'error' | 'conflict', text: string): void {
  syncState.value = kind
  syncErrorText.value = text
  if (kind === 'conflict') {
    syncNotice.value = { text: `${text},已暂停上传以免覆盖`, at: Date.now() }
  } else if (failStreak === 3) {
    syncNotice.value = { text: '云同步失败,进度暂存本机', at: Date.now() }
  }
}

/** 档案快照:随存档上传,供排行榜 / 好友列表 / 切磋 / GM 后台使用 */
export function buildProfileSnapshot(): {
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
} {
  const player = usePlayerStore()
  const { attack, defense, maxHp } = player.finalStats
  const power = powerScore(attack, defense, maxHp)
  return {
    name: player.name,
    realmLabel: realmLabel(player.major, player.sub),
    realmIndex: player.major * 100 + player.sub,
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

let pushing = false

/**
 * 推送结果:ok=已上传;skipped-* = 静默跳过(此前一律谎报成功,设置页「立即上传」会弹出
 * 「已上传到云端」的假象,玩家转头恢复却报「云端还没有存档」);conflict/failed = 失败。
 */
export type PushOutcome = 'ok' | 'skipped-login' | 'skipped-not-started' | 'skipped-busy' | 'conflict' | 'failed'

/**
 * 推送当前存档到云端;未登录 / 未开局 / 推送中按 skipped-* 返回,不再谎报成功。
 * manual=true 时无视冲突封锁(玩家明确要求以本机为准)。
 */
export async function pushCloudSave(manual = false): Promise<PushOutcome> {
  const auth = useAuthStore()
  const game = useGameStore()
  if (!auth.loggedIn) return 'skipped-login'
  if (!game.started) return 'skipped-not-started'
  if (pushing) return 'skipped-busy'
  if (blocked && !manual) return 'conflict'
  pushing = true
  try {
    let base = readBase()
    // 从未与云端对齐过:先确认云端确实没有档。否则本机可能是残留新手档,一推就把云端老档顶掉
    if (!manual && base === 0) {
      const cloud = await cloudApi.getSave()
      if (cloud.save !== null) {
        if (!game.started) {
          blocked = true
          report('conflict', '云端已有存档,本机尚未同步')
          return 'conflict'
        }
        // 本机已开局但从未对齐(锚点机制上线前的老客户端 / 开机时拉档失败的长驻页):
        // 单设备登录下本机就是该账号的唯一在线设备,视为同一份进度延续,接续云端锚点恢复自动上传。
        // 不再永久停传(否则 GM 后台看到的「存档更新」时间会一直不动)。
        base = cloud.save.updatedAt
        writeBase(base)
        syncNotice.value = { text: '已接续云端进度,恢复自动上传', at: Date.now() }
      }
    }
    const payload = buildExportPayload()
    const res = await cloudApi.putSave({
      version: SAVE_VERSION,
      data: payload.data,
      profile: buildProfileSnapshot(),
      // 手动上传视为「以本机为准」:不带锚点,服务端不做冲突判定
      ...(manual || base === 0 ? {} : { baseUpdatedAt: base })
    })
    // 老后端不返回 updatedAt:保持原锚点,别把已对齐状态清零
    if (typeof res.updatedAt === 'number') writeBase(res.updatedAt)
    blocked = false
    failStreak = 0
    syncState.value = 'ok'
    syncErrorText.value = ''
    lastSyncAt.value = Date.now()
    return 'ok'
  } catch (e) {
    failStreak += 1
    if (e instanceof CloudError && e.status === 409) {
      blocked = true
      report('conflict', e.message)
      return 'conflict'
    }
    report('error', e instanceof CloudError ? e.message : '网络不通')
    // 下一个周期重推
    return 'failed'
  } finally {
    pushing = false
  }
}

export type PullResult = { status: 'applied' } | { status: 'empty' } | { status: 'error'; message: string }

/**
 * 拉取云端存档并应用(覆盖本地),应用成功后重载。
 * 'applied' = 云端有档已应用;'empty' = 云端无档;'error' = 云端有档但应用失败(此时不得进空档流程)。
 */
export async function pullCloudSave(): Promise<PullResult> {
  const res = await cloudApi.getSave()
  if (res.save === null) return { status: 'empty' }
  const err = applySavePayload({
    game: 'yunyin-xiuxian',
    version: res.save.version,
    exportedAt: res.save.updatedAt,
    data: res.save.data
  })
  if (err !== null) return { status: 'error', message: err }
  // 应用成功才对齐锚点;写盘完成后才 reload
  writeBase(res.save.updatedAt)
  blocked = false
  reloadGame()
  return { status: 'applied' }
}

/**
 * 云端有档而本机无档(或本机从未与云端对齐)时的首登:直接采用云端档。
 * 已对齐过的设备不在此处覆盖,避免把本机离线进度冲掉(改为提示,由玩家在设置页决定)。
 */
export async function restoreFromCloud(): Promise<boolean> {
  const auth = useAuthStore()
  const game = useGameStore()
  if (!auth.loggedIn) return false
  if (game.started && cloudAligned()) return false
  try {
    const res = await cloudApi.getSave()
    if (res.save === null) return false
    const err = applySavePayload({
      game: 'yunyin-xiuxian',
      version: res.save.version,
      exportedAt: res.save.updatedAt,
      data: res.save.data
    })
    if (err !== null) {
      report('error', `云端存档应用失败:${err}`)
      return false
    }
    writeBase(res.save.updatedAt)
    reloadGame()
    return true
  } catch {
    return false
  }
}

/**
 * 启动探针:本机已对齐过,但云端时间戳比本机锚点新 —— 说明别的设备写过。
 * 不自动覆盖(本机可能有未上传的进度),只返回信息供界面提示。
 */
export async function probeCloudNewer(): Promise<number | null> {
  const auth = useAuthStore()
  if (!auth.loggedIn) return null
  try {
    const res = await cloudApi.getSave()
    if (res.save === null) return null
    const base = readBase()
    return base > 0 && res.save.updatedAt > base ? res.save.updatedAt : null
  } catch {
    return null
  }
}

/** 客户端与服务端时钟的容差:关页盖章(客户端钟)对锚点(服务端钟)比较时吸收偏差 */
const CLOCK_SKEW_MS = 120_000

/**
 * 模块加载时刻读磁盘里上一会话的关页盖章:引擎 start 会立刻在内存里重盖 lastActiveAt,
 * 但 5 秒刷盘窗口内磁盘仍是旧值;此刻读取(早于任何 store 水合写回)拿到的是关页时刻。
 */
function readPersistedLastActive(): number {
  try {
    const raw = localStorage.getItem(storageKey('game'))
    if (raw === null) return 0
    // 磁盘是密文,须经 readSaveText 解码(明文旧档/待刷队列同样兼容)
    const obj = JSON.parse(readSaveText(raw)) as { lastActiveAt?: unknown }
    return typeof obj.lastActiveAt === 'number' && Number.isFinite(obj.lastActiveAt) ? obj.lastActiveAt : 0
  } catch {
    return 0
  }
}

const bootPersistedLastActive = readPersistedLastActive()

/**
 * 开局自动接管:本机已开局且对齐过,但云端档更新(别的设备/上一会话的最后一推)。
 * 仅当本机自上次对齐后没有新进度(关页盖章不晚于锚点+钟差)才自动覆盖,
 * 否则回落到 probeCloudNewer 的人工提示,绝不悄悄冲掉本机进度。
 * 返回是否已应用并即将重载。
 */
export async function autoRestoreIfNewer(): Promise<boolean> {
  const auth = useAuthStore()
  const game = useGameStore()
  if (!auth.loggedIn || !game.started || !cloudAligned()) return false
  if (bootPersistedLastActive > readBase() + CLOCK_SKEW_MS) return false
  try {
    const res = await cloudApi.getSave()
    if (res.save === null) return false
    if (res.save.updatedAt <= readBase()) return false
    const err = applySavePayload({
      game: 'yunyin-xiuxian',
      version: res.save.version,
      exportedAt: res.save.updatedAt,
      data: res.save.data
    })
    if (err !== null) {
      report('error', `云端存档应用失败:${err}`)
      return false
    }
    writeBase(res.save.updatedAt)
    blocked = false
    reloadGame()
    return true
  } catch {
    return false
  }
}

let timer: ReturnType<typeof setInterval> | undefined

/** 启动云同步:App 挂载后调用一次;登出时 stopCloudSync */
export function startCloudSync(): void {
  const auth = useAuthStore()
  if (!auth.loggedIn || timer !== undefined) return
  // 间隔以服务端配置为准(GM 后台 save_push_interval_sec);拿不到就用当前默认
  void cloudApi
    .authConfig()
    .then(c => {
      const sec = Math.min(Math.max(c.saveIntervalSec ?? 20, 3), 300)
      if (sec * 1000 !== pushIntervalMs) {
        pushIntervalMs = sec * 1000
        // 已在同步中则按新间隔重排定时器
        if (timer !== undefined) {
          clearInterval(timer)
          timer = setInterval(() => {
            if (document.visibilityState === 'hidden') return
            void pushCloudSave()
          }, pushIntervalMs)
        }
      }
    })
    .catch(() => undefined)
  void pushCloudSave()
  timer = setInterval(() => {
    if (document.visibilityState === 'hidden') return
    void pushCloudSave()
  }, pushIntervalMs)
}

export function stopCloudSync(): void {
  if (timer !== undefined) {
    clearInterval(timer)
    timer = undefined
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    // pagehide 里同步刷盘由 storage 层负责;云端推送尽力而为(keepalive fetch 才可靠,普通 fetch 会被砍)
    if (document.visibilityState === 'hidden') void pushCloudSave()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void pushCloudSave()
  })
}
