/** 存档服务:云端档应用 / 重置 / 迁移 */
import {
  applyImportPayload,
  clearAllSave,
  migrateHerbSlice,
  migrateInventorySlice,
  SAVE_VERSION,
  validateImportPayload,
  type ExportPayload
} from '@/utils/storage'
import { useGameStore } from '@/stores/game'
import { engine } from './engine'

/** 迁移旧版本存档(链式) */
function migrate(payload: ExportPayload): ExportPayload {
  const migrated = { ...payload, data: { ...payload.data } }
  if (migrated.version < 2 && typeof migrated.data.inventory === 'object' && migrated.data.inventory !== null) {
    migrated.data.inventory = migrateInventorySlice(migrated.data.inventory as Record<string, unknown>)
  }
  // 灵草五品:旧档单标量 herb 按当前境界折算成品阶分账(同版本形状迁移,恒执行)
  if (typeof migrated.data.resources === 'object' && migrated.data.resources !== null) {
    migrated.data.resources = migrateHerbSlice(migrated.data.resources as Record<string, unknown>)
  }
  // lastActiveAt 重戳为现在:沿用导出时刻会被算成缺勤数月
  // (离线资源按 8h 封顶、年龄却按全程流,先死)
  if (migrated.data.game && typeof migrated.data.game === 'object') {
    migrated.data.game = { ...(migrated.data.game as Record<string, unknown>), lastActiveAt: Date.now() }
  }
  migrated.version = SAVE_VERSION
  return migrated
}

/**
 * 云端存档应用入口:校验/迁移/原子写盘链路,来源是对象而非密文文本。
 * 成功返回 null;失败已回滚旧档,返回错误信息。
 */
export function applySavePayload(parsed: unknown): string | null {
  const error = validateImportPayload(parsed)
  if (error) return error
  try {
    applyImportPayload(migrate(parsed as ExportPayload))
  } catch (e) {
    return e instanceof Error ? e.message : '存档写入失败'
  }
  return null
}

/**
 * 封存写盘:页面即将卸载时,丢弃一切后续 localStorage 写入。
 * persist 插件经 Vue 调度器微任务批量刷盘,清档/导入之后、卸载之前排队的持久化仍会回写(persistState → flushJobs)。
 * 在写盘层截断(拦截 mutation 源头不可穷尽)。
 * 须在导入写盘完成之后调用:setItem 被置为 noop,先调用会吞掉导入的写入。
 */
export function sealStorageWrites(): void {
  const noop = (): undefined => undefined
  // 主路径:改写 Storage.prototype(对所有 Storage 实例生效)
  try {
    Object.defineProperty(Storage.prototype, 'setItem', { value: noop, configurable: true, writable: true })
  } catch {
    // 原型被冻结时降级到下面的实例路径
  }
  // 备用路径:直接改实例。不能作为唯一手段:Storage 带命名属性 setter,
  // 部分 WebView(实测 Android WebView 91)会把这次 defineProperty 存成一条 key 为 setItem 的记录,封存静默失效
  try {
    Object.defineProperty(window.localStorage, 'setItem', { value: noop, configurable: true })
  } catch {
    // 存储不可用时无事可做
  }
}

/**
 * 清空全部存档并回到欢迎页。
 * 顺序:停引擎(去掉 beforeunload 写档)→ 封存写盘(丢弃排队刷盘)→ 清档 → 重载。
 * 不碰 location.hash:改 hash 触发 SPA 导航,persist 订阅会把刚清掉的分片回写
 * (实测 Android WebView 封存失效时 game 分片被写回 started:true,重载后卡在主页);清档后守卫自会弹回 welcome。
 */
export function resetGame(): void {
  engine.stop()
  sealStorageWrites()
  clearAllSave()
  // 内存兜底:reload 异步,卸载前页面仍在跑;两条封存路径都失效时,排队刷盘写回的也是 started:false
  try {
    useGameStore().started = false
  } catch {
    // Pinia 未激活时忽略
  }
  window.location.reload()
}

/**
 * 重载(导入存档后调用)。封存写盘,防排队刷盘在卸载前覆盖刚导入的分片。
 * 不碰 hash:内存 store 还是旧存档,SPA 导航引发的回写会覆盖刚导入的数据。
 */
export function reloadGame(): void {
  engine.stop()
  sealStorageWrites()
  window.location.reload()
}
