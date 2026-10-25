/** 存档备份账,供设置页「上次导出备份:…」一行。纯函数。 */

/** 备份过旧阈值,单位:天 */
export const BACKUP_STALE_DAYS = 14

/** 存档攒够此天数才提醒备份 */
export const SAVE_WORTH_BACKUP_DAYS = 3

export type BackupAdvice = 'never' | 'stale' | 'fresh'

/** 上次导出距今几天;没导出过返回 null */
export function daysSinceExport(lastExportAt: number, now: number): number | null {
  // 字段来自持久化,可能非数字;不依赖 sanitize 已跑过
  if (!Number.isFinite(lastExportAt) || lastExportAt <= 0) return null
  if (!Number.isFinite(now)) return null
  return Math.max(0, Math.floor((now - lastExportAt) / 86400000))
}

export function backupAdvice(lastExportAt: number, now: number): BackupAdvice {
  const days = daysSinceExport(lastExportAt, now)
  if (days === null) return 'never'
  return days >= BACKUP_STALE_DAYS ? 'stale' : 'fresh'
}

/** 是否提醒备份(该行转琥珀色):备份旧或从未导出,且存档已攒够天数 */
export function shouldPromptBackup(lastExportAt: number, saveCreatedAt: number, now: number): boolean {
  if (backupAdvice(lastExportAt, now) === 'fresh') return false
  const saveDays = (now - saveCreatedAt) / 86400000
  return saveCreatedAt > 0 && saveDays >= SAVE_WORTH_BACKUP_DAYS
}

/** 设置页该行文本 */
export function formatLastExport(lastExportAt: number, now: number): string {
  const days = daysSinceExport(lastExportAt, now)
  if (days === null) return '从未导出'
  if (days === 0) return '今天'
  return `${days} 天前`
}
