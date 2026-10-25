/**
 * 古语时制与现代时长的对应;时长文案的唯一事实源(丹药 / buff 描述、「折合闭关」,见 core/pillService、ui/itemText)。
 * 口径与 xian 同表。「时」会被读成「时辰」(一个时辰 = 2 小时)。
 *
 * - 只有确切落在表上的时长用古语;表外用「将近 X / X 有余」并附分钟数。
 * - spec 钉:timeUnits.spec(带时长的文案对数据反查)。
 * - 倒计时 / 总时长 / 研读 ETA 走 utils/format 的 formatDuration / formatCountdown:定宽胶囊里古语会跳宽。
 */

/** 一盏茶 */
export const TEA_SEC = 600
/** 一刻(一刻钟) */
export const KE_SEC = 900
/** 一炷香 */
export const INCENSE_SEC = 1800
/** 半个时辰(= 一时,1 小时) */
export const HALF_SHICHEN_SEC = 3600
/** 一个时辰(= 二时,2 小时) */
export const SHICHEN_SEC = 7200

const CN = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'] as const

/** 1..99 的汉字数词 */
export function cnNum(n: number): string {
  if (n <= 10) return CN[n]!
  if (n < 20) return `十${n === 10 ? '' : CN[n - 10]}`
  const tens = Math.floor(n / 10)
  const ones = n % 10
  return `${CN[tens]}十${ones === 0 ? '' : CN[ones]}`
}

/** 现代时长:小时优先,不足一小时说分钟 */
export function modernDuration(sec: number): string {
  if (sec % 3600 === 0) return `${sec / 3600} 小时`
  if (sec % 60 === 0) return `${sec / 60} 分钟`
  return `${Math.round(sec)} 秒`
}

function countWord(n: number): string {
  return n === 2 ? '两' : cnNum(n)
}

/** 秒数 → 古今对照一句,如「一炷香(30 分钟)」 */
export function classicalDuration(sec: number): string {
  const exact: Record<number, string> = {
    [TEA_SEC]: '一盏茶',
    [KE_SEC]: '一刻',
    [INCENSE_SEC]: '一炷香',
    [HALF_SHICHEN_SEC]: '半个时辰',
    [SHICHEN_SEC]: '一个时辰',
  }
  const hit = exact[sec]
  if (hit) return `${hit}(${modernDuration(sec)})`
  if (sec % SHICHEN_SEC === 0) return `${countWord(sec / SHICHEN_SEC)}个时辰(${modernDuration(sec)})`
  // 半个时辰的奇数倍(1.5 / 2.5 时辰)说「一个半时辰」,不说「十二刻」
  if (sec % HALF_SHICHEN_SEC === 0)
    return `${countWord((sec - HALF_SHICHEN_SEC) / SHICHEN_SEC)}个半时辰(${modernDuration(sec)})`
  if (sec % KE_SEC === 0) return `${countWord(sec / KE_SEC)}刻(${modernDuration(sec)})`
  const near = Math.floor(sec / KE_SEC) * KE_SEC
  if (near >= KE_SEC) return `${countWord(near / KE_SEC)}刻有余(${modernDuration(sec)})`
  return `将近一刻(${modernDuration(sec)})`
}

const CN_DIGIT: Record<string, number> = {
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
}

function cnToNum(s: string): number | null {
  if (s === '半') return 0.5
  if (s.length === 1 && CN_DIGIT[s] !== undefined) return CN_DIGIT[s]!
  if (s.startsWith('十')) return 10 + (s.length > 1 ? (CN_DIGIT[s[1]!] ?? 0) : 0)
  if (s.includes('十')) {
    const [a, b] = s.split('十')
    const tens = CN_DIGIT[a!] ?? 1
    const ones = b ? (CN_DIGIT[b] ?? 0) : 0
    return tens * 10 + ones
  }
  return null
}

export interface ClassicalClaim {
  /** 折出的秒数 */
  sec: number
  /** true = 确切说法;近似(将近 / 有余)只许落在最近一档的一刻之内,且将近 < 值 < 有余 */
  exact: boolean
}

/** 文案里的时制词 → 秒,认不出返回 null;供判据反查文案与数据时长 */
export function parseClassicalDuration(text: string): ClassicalClaim | null {
  // 支持「半个时辰」「一个时辰」「一个半时辰」「两个半时辰」四种写法
  const m =
    /(将近|有余)?\s*(半|[一二两三四五六七八九十]+)?\s*(个)?\s*(半)?\s*(时辰|刻|炷香|盏茶)(有余)?/.exec(
      text
    )
  if (!m) return null
  const exact = !m[1] && !m[6]
  const unit = m[5]!
  const per =
    unit === '时辰'
      ? SHICHEN_SEC
      : unit === '刻'
        ? KE_SEC
        : unit === '炷香'
          ? INCENSE_SEC
          : TEA_SEC
  // 「一炷香」「一盏茶」是专名,数量词不参与乘法
  if (unit === '炷香' || unit === '盏茶') return { sec: per, exact }
  let n: number | null
  if (m[4]) {
    // 「一个半时辰」= 整数 + 半个
    const whole = m[2] && m[2] !== '半' ? cnToNum(m[2]) : 0
    n = whole === null ? null : whole + 0.5
  } else {
    n = m[2] ? cnToNum(m[2]) : 1
  }
  if (n === null) return null
  const sec = n * per
  return { sec, exact }
}
