/**
 * 存档上云:登录后定时把本地分片推到服务器,登录/启动时拉取云端档覆盖本地。
 * 本地 localStorage 降级为缓存;服务器为权威副本。
 * 云端应用与本地导入走同一条校验/迁移/原子写盘链路(core/save.applySavePayload)。
 */
import { buildExportPayload, SAVE_VERSION } from '@/utils/storage'
import { realmLabel } from '@/data/realms'
import { powerScore } from '@/core/formulas'
import { applySavePayload, reloadGame } from '@/core/save'
import { cloudApi } from '@/services/cloud'
import { useAuthStore } from '@/stores/auth'
import { useGameStore } from '@/stores/game'
import { usePlayerStore } from '@/stores/player'

const PUSH_INTERVAL_MS = 20000

/** 档案快照:随存档上传,供排行榜 / 好友列表 / 切磋使用 */
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
    atkE: attack.e
  }
}

let pushing = false

/** 推送当前存档到云端;未登录 / 未开局 / 推送中静默跳过。返回是否成功(或无需推送) */
export async function pushCloudSave(): Promise<boolean> {
  const auth = useAuthStore()
  const game = useGameStore()
  if (!auth.loggedIn || !game.started || pushing) return true
  pushing = true
  try {
    const payload = buildExportPayload()
    await cloudApi.putSave({ version: SAVE_VERSION, data: payload.data, profile: buildProfileSnapshot() })
    return true
  } catch {
    // 下一个周期重推;失败不弹窗(后台同步不打扰)
    return false
  } finally {
    pushing = false
  }
}

/**
 * 拉取云端存档并应用(覆盖本地),应用成功后重载。
 * 返回 'applied' = 云端有档已应用;'empty' = 云端无档(本地档随后的自动推送会上传);'error' = 应用失败。
 */
export async function pullCloudSave(): Promise<'applied' | 'empty' | 'error'> {
  const res = await cloudApi.getSave()
  if (res.save === null) return 'empty'
  const err = applySavePayload({
    game: 'yunyin-xiuxian',
    version: res.save.version,
    exportedAt: res.save.updatedAt,
    data: res.save.data
  })
  if (err !== null) return 'error'
  reloadGame()
  return 'applied'
}

/** 云端有档而本地无档的首次登录:应用云端档;云端无档则进入正常开局流程 */
export async function restoreFromCloud(): Promise<boolean> {
  const auth = useAuthStore()
  const game = useGameStore()
  if (!auth.loggedIn || game.started) return false
  try {
    const res = await cloudApi.getSave()
    if (res.save === null) return false
    const err = applySavePayload({
      game: 'yunyin-xiuxian',
      version: res.save.version,
      exportedAt: res.save.updatedAt,
      data: res.save.data
    })
    if (err !== null) return false
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
  void pushCloudSave()
  timer = setInterval(() => {
    if (document.visibilityState === 'hidden') return
    void pushCloudSave()
  }, PUSH_INTERVAL_MS)
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
