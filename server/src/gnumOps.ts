/**
 * 服务端侧的 GNum({m, e} = m × 10^e)算术原语(1.79.11)。
 *
 * 为什么不直接 float 相减:资源余额的加减要与客户端 utils/gnum 同口径 ——
 * 指数差超过 15 的小额项忽略、结果归一到 1~10 尾数,否则同一笔账两端各自算,
 * 格式化出来的数会打架。粗算(整个数拉成 float)在 a ≈ b 的量级会有灾难性抵消,
 * 1e15 附近的差额直接算丢。
 */

interface GNumDto {
  m: number
  e: number
}

/** 与客户端 NEGLIGIBLE_EXP_DIFF 同值:指数差超过它的小额项忽略 */
const NEGLIGIBLE_EXP_DIFF = 15

function isDto(v: unknown): v is GNumDto {
  return (
    typeof v === 'object' &&
    v !== null &&
    Number.isFinite((v as GNumDto).m) &&
    Number.isFinite((v as GNumDto).e)
  )
}

function normalize(m: number, e: number): GNumDto {
  if (m <= 0 || !Number.isFinite(m) || !Number.isFinite(e)) return { m: 0, e: 0 }
  const shift = Math.floor(Math.log10(m))
  const nm = m / Math.pow(10, shift)
  if (!Number.isFinite(nm)) return { m: 0, e: 0 }
  if (nm >= 10) return { m: nm / 10, e: e + shift + 1 }
  return { m: nm, e: e + shift }
}

function addRaw(a: GNumDto, b: GNumDto): GNumDto {
  if (a.m <= 0) return { ...b }
  if (b.m <= 0) return { ...a }
  const hi = a.e >= b.e ? a : b
  const lo = hi === a ? b : a
  const diff = hi.e - lo.e
  if (diff > NEGLIGIBLE_EXP_DIFF) return { ...hi }
  return normalize(hi.m + lo.m * Math.pow(10, -diff), hi.e)
}

/** a + b;坏值按 0 */
export function gnumAdd(a: unknown, b: unknown): GNumDto {
  return addRaw(isDto(a) ? a : { m: 0, e: 0 }, isDto(b) ? b : { m: 0, e: 0 })
}

/** a − b,保底为 0(资源扣款不透支);坏值按 0 */
export function gnumSub(a: unknown, b: unknown): GNumDto {
  const x = isDto(a) ? a : { m: 0, e: 0 }
  const y = isDto(b) ? b : { m: 0, e: 0 }
  if (x.m <= 0) return { m: 0, e: 0 }
  if (y.m <= 0) return { ...x }
  /*
   * 1.79.18:先比较实际大小再相减。旧实现按「指数大者为主项」推公式,
   * 被减数指数小于减数时走 x.e < y.e 分支,hi/lo 位置颠倒 ——
   * y.m×10^(-diff) − x.m 在特定取值下会算出正数,「保底 0」失效。
   * 当前归一化不变量(m∈[1,10))恰好挡住它,但靠外部不变量兜底的减法不该存在。
   */
  const xVal = x.m * Math.pow(10, x.e - Math.max(x.e, y.e))
  const yVal = y.m * Math.pow(10, y.e - Math.max(x.e, y.e))
  const diffE = Math.max(x.e, y.e)
  if (x.e - y.e > NEGLIGIBLE_EXP_DIFF) return { ...x }
  if (y.e - x.e > NEGLIGIBLE_EXP_DIFF) return { m: 0, e: 0 }
  if (yVal >= xVal) return { m: 0, e: 0 }
  return normalize(xVal - yVal, diffE)
}
