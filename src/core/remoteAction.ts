/**
 * 动作上报:把「玩家点的那一下」交给服务端执行,本地那次只作显示预测。
 *
 * 为什么(1.78.0):
 *   此前所有主动动作(吃丹/炼丹/际遇/秘境/熔炉/分解/卖出/兑换/装配)都在客户端结算,
 *   服务端只在 PUT /save 时事后钳制 —— 钳制是「允许一段增量」,分几次上传就把改包洗白了。
 *   现在服务端在云档上跑**同一份结算代码**(core/actionOps),把改动的分片键级 diff 回传:
 *   客户端按 diff 覆盖本地,真实进度由服务端那份说了算。
 *
 * 三条纪律:
 *   1. **只在浏览器里发**:服务端无头跑 actionOps 时会调到这里,`typeof window === 'undefined'`
 *      即直接返回 —— 否则服务端会对着自己发 HTTP 请求。
 *   2. **不阻塞界面**:动作先本地跑完(玩家立刻看到反馈),上报是后台的;失败不回滚 UI,
 *      而是拉一次云档重对齐(actionResync),让下一次渲染就是真值。
 *   3. **不重试**:网络抖动交给心跳与下一次 PUT /save 对账;动作重放会让「吃一枚丹」变成两枚。
 */
import { useAuthStore } from '@/stores/auth'
import { CloudError, cloudApi } from '@/services/cloud'
import { sliceStoreOf } from './sliceStores'

/** 服务端回传的分片补丁:顶层键级 $patch,未知分片忽略 */
function applySlices(slices: Record<string, Record<string, unknown>>): void {
  for (const [id, fields] of Object.entries(slices)) {
    const store = sliceStoreOf(id)
    if (store === undefined) continue
    store.$patch(fields)
  }
}

/** 重对齐进行中:并发拒绝时不必拉几次整档 */
let resyncing = false

/**
 * 预测作废后的重对齐:取云档完整分片覆盖本地。
 * 只在服务端明确拒绝(ok=false)时调用 —— 那是「本地以为成功、服务端说不行」的唯一情形。
 */
export async function resyncFromCloud(): Promise<void> {
  if (resyncing) return
  resyncing = true
  try {
    const res = await cloudApi.actionResync()
    if (res.slices === null) return
    for (const [id, slice] of Object.entries(res.slices)) {
      const store = sliceStoreOf(id)
      if (store === undefined) continue
      if (typeof slice !== 'object' || slice === null || Array.isArray(slice)) continue
      store.$patch(slice as Record<string, unknown>)
    }
  } catch {
    // 拉不到就等下一次心跳/PUT /save 对账:这里不是必须成功的一步
  } finally {
    resyncing = false
  }
}

export interface ActionResultEcho {
  /** 服务端执行成功 */
  ok: boolean
  /** 失败原因(ok=false 时) */
  reason?: string
  /** 动作自身的返回值(战斗结果 / 产出清单) */
  payload?: unknown
}

/**
 * 等结果的动作(1.79.0):往返一次、拿回服务端算出来的那个值。
 *
 * 与 `reportAction` 的分工:
 *   - `reportAction`:本地已经跑过、界面已经看到结果,上报只是让服务端记一笔(吃丹、开炉);
 *   - `runActionAwait`:界面**要显示服务端算出来的东西**(远征战报、转世交割单、坊市买到的货),
 *     本地那份预测会与界面上的数字打架,所以干脆等它回来再画。
 *
 * 三条口径:
 *   1. 未登录 / 无窗口 → 走 `local`(单机与测试环境必须能玩);没给 `local` 就是「只能服务端做」。
 *   2. 服务端**明确拒绝**(ok=false)→ 不跑 `local`(它会把一件服务端不认的事做出来),
 *      拉一次整档重对齐后如实回报失败。
 *   3. 网络不通 → 有 `local` 就跑(断网时保住玩法),没有就报失败。
 *      本地这一份与云端会短暂分叉,恢复后由心跳/重对齐收口 —— 与其它预测路径同一代价。
 */
export async function runActionAwait<T = unknown>(
  kind: string,
  params: Record<string, unknown> = {},
  local?: () => T | Promise<T>
): Promise<{ ok: boolean; value: T | null; reason?: string }> {
  /** 本地实现可能是 async(坊市买入要先签发装备),这里一律等它 */
  const fallback = async (): Promise<{ ok: boolean; value: T | null; reason?: string }> => {
    if (local === undefined) return { ok: false, value: null, reason: '此刻需要联网' }
    try {
      return { ok: true, value: await local() }
    } catch (e) {
      return { ok: false, value: null, reason: e instanceof Error ? e.message : '结算失败' }
    }
  }
  if (typeof window === 'undefined') return await fallback()
  let loggedIn = false
  try {
    loggedIn = useAuthStore().loggedIn
  } catch {
    loggedIn = false
  }
  if (!loggedIn) return await fallback()
  try {
    const res = await cloudApi.actionOp({ kind, ...params })
    if (res.ok) {
      if (res.slices !== undefined) applySlices(res.slices)
      return { ok: true, value: (res.payload as T | null) ?? null }
    }
    void resyncFromCloud()
    return { ok: false, value: null, reason: res.reason ?? '天道不许' }
  } catch (e) {
    if (e instanceof CloudError && e.status === 429) {
      return { ok: false, value: null, reason: '稍候再试' }
    }
    return await fallback()
  }
}

/** 上报结果回调:界面需要拿到「服务端说成了几枚/打到什么」时才用 */
type Echo = (r: ActionResultEcho) => void

/**
 * 穿戴/卸下的服务端对账(1.79.7)。
 *
 * 为什么上报**整张** equipped 而不是「这一个槽位」:
 *   一键换装连穿数件 → 数个上报撞服务端 250ms 限速,被 429 丢的就不止一件;
 *   只报单槽时云档便停在半换状态,下一次权威回传会把本地盖回旧件 —— 正是
 *   「点一键分解,穿戴却被换掉」的根源(云档 equipped 陈旧 → 分解被拒 → 整档重对齐)。
 *   整张快照则相反:每一发都带齐全部槽位,任一发生效即为完整同步,不挑到达顺序。
 *
 * 为什么不套 reportAction:那会把回包的 equipped 补丁 $patch 回本地。批量换装回包
 * 乱序时,后到的旧快照反而会把刚换好的槽位盖回旧件。穿戴即时反馈的纯预测,服务端
 * 只需记下最终映射,不必回写;失败也不回滚(下一拍心跳/分解上报由云档收口)。
 *
 * 无头水合时 `typeof window === 'undefined'` 必然成立:服务端 actionOps 自己跑装配
 * 分支经过 store 的 equip() 时这里直接跳过,避免服务端对自己发 HTTP。
 *
 * 防抖时戳:略大于服务端 250ms 动作闸门,连换只发最后一发完整快照。
 */
let equipSyncTimer: ReturnType<typeof setTimeout> | undefined
const EQUIP_SYNC_DELAY_MS = 300

export function reportEquipChange(): void {
  if (typeof window === 'undefined') return
  if (equipSyncTimer !== undefined) clearTimeout(equipSyncTimer)
  equipSyncTimer = setTimeout(() => {
    equipSyncTimer = undefined
    try {
      if (!useAuthStore().loggedIn) return
      const inv = sliceStoreOf('inventory')
      if (inv === undefined) return
      const equipped = (inv.$state as { equipped?: unknown }).equipped
      void cloudApi.actionOp({ kind: 'equip_set', equipped: equipped ?? {} }).catch(() => {
        // 旁路:网络问题不打断穿戴,下一拍心跳/动作由云档收口
      })
    } catch {
      // 取 auth / store 抛错也不该影响本地穿戴本身
    }
  }, EQUIP_SYNC_DELAY_MS)
}

/**
 * 上报一个动作。返回是否**已发出**(未登录/无窗口时恒 false,调用方据此决定要不要等)。
 * 不返回 Promise:动作是「已经做完的事」,界面不该为此挂 loading。
 */
export function reportAction(kind: string, params: Record<string, unknown> = {}, echo?: Echo): boolean {
  if (typeof window === 'undefined') return false
  /*
   * 上报是「尽力而为」:取 auth / 发请求任何一步抛错都不能冒到调用方 ——
   * 调用方是玩法结算函数,它的事已经做完了,不该因为一条旁路上报把整段推进带崩
   * (1.78.0 首版就踩过:测试环境没有 auth store,异常一路冒到 advanceResolve 的 catch)。
   */
  try {
    const auth = useAuthStore()
    if (!auth.loggedIn) return false
    void cloudApi
      .actionOp({ kind, ...params })
      .then(res => {
        if (res.ok) {
          if (res.slices !== undefined) applySlices(res.slices)
          echo?.({ ok: true, payload: res.payload })
          return
        }
        /*
         * 服务端拒绝:本地那次预测必须整体作废。
         * 不在这里逐字段回滚(要还原的面太大),直接拉云档重对齐 —— 频率低(只有被拒时),
         * 且玩家看到的是「刚才那下没成」,比看到一个假数值更对。
         */
        echo?.({ ok: false, reason: res.reason })
        void resyncFromCloud()
      })
      .catch(e => {
        // 429 = 动作太密(限速 250ms):本地已做完,服务端下一次动作/心跳会带上,静默即可
        if (e instanceof CloudError && e.status === 429) return
        // 网络问题:同上,不重放(重放会把「吃一枚」变成两枚)
        try {
          echo?.({ ok: false, reason: e instanceof CloudError ? e.message : '网络不通' })
        } catch {
          // 回调自己抛错也不该影响上报链路
        }
      })
    return true
  } catch {
    return false
  }
}
