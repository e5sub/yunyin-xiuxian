export function now(): number {
  return Date.now()
}

/** 本地日期字符串,用于每日任务重置 */
export function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

/** 时间戳 → 本地日整数(YYYYMMDD);纯函数,不碰墙钟 */
export function localDayNum(at: number): number {
  const d = new Date(at)
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()
}

/**
 * 本地日整数(YYYYMMDD),用于「每日一次」类闸门。
 * 与 todayStr 同一本地日口径,不用 UTC 日(否则同一本地日能巡游两次)。
 */
export function todayLocalNum(): number {
  return localDayNum(Date.now())
}

/** 时间戳 → 可读「M月D日」 */
export function formatDate(ts: number): string {
  const d = new Date(ts)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

/** 距下一个本地午夜还有多少秒(日课更替);与 todayLocalNum 同一本地日口径,纯函数 */
export function secsUntilNextMidnight(from: number): number {
  const d = new Date(from)
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0)
  return Math.max(0, (next.getTime() - from) / 1000)
}
