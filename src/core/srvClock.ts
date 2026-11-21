/**
 * 服务端时钟对齐(1.79.10):历练节拍的两端钟差治理。
 *
 * 为什么:历练会话的节拍戳在两端各写一半 —— 开局 `startExploration` 用本机钟
 * 盖 `startedAt/endsAt/nextBattleAt`,开打后服务端水合推进(`tickExploration`)
 * 用**服务端的钟**改写 `nextBattleAt`;而服务端判开打是 `serverNow >= nextBattleAt`。
 * 本机钟比服务器快 S 秒时:倒计时按本机钟归零,服务端却还要等 S 秒才认到点,
 * 客户端 2.2 秒一拍地催,催两三拍才开打 —— 体感正是「归零后干等约 5 秒」。
 *
 * 对齐来源:`/game/advance` 回包带的 `now`(服务端组包时刻)+ 半程 RTT 修正;
 * 每拍心跳(5 秒)都校一次,取最近一次估计 —— 单次估计带 ±半程 RTT 噪声,
 * 相对 5 秒一拍的节拍可忽略,换确定性(测试可精确断言)。
 * 未登录没有心跳回包,offset 恒 0:单机路径读 `srvNow()` 与 Date.now() 同值,口径不变。
 */

/** 当前估计的服务端钟差(服务端时刻 − 本机时刻,毫秒) */
let offsetMs = 0

/** 估计钳幅:NTP 正常误差是秒级,偏离过大说明回包不可信,丢弃不采纳 */
const OFFSET_CLAMP_MS = 120_000
/** 半程 RTT 参与估计的上界:断网重连首拍 RTT 可达数十秒,不钳会把估计拽飞 */
const RTT_CLAMP_MS = 10_000

/**
 * 用一拍心跳回包校钟。`srvNow` 是服务端组包时刻(epoch 毫秒),`rttMs` 是本机实测往返。
 * 估计 = srvNow + rtt/2 − 本机收包时刻(服务端组包到本机收包隔了半程网络)。
 */
export function noteSrvClock(srvNow: unknown, rttMs: number): void {
  if (typeof srvNow !== 'number' || !Number.isFinite(srvNow) || srvNow <= 0) return
  const half = Math.min(Math.max(rttMs, 0), RTT_CLAMP_MS) / 2
  const est = srvNow + half - Date.now()
  if (est > OFFSET_CLAMP_MS || est < -OFFSET_CLAMP_MS) return
  offsetMs = Math.round(est)
}

/** 服务端时间域的「现在」:与服务端互认的节拍戳(nextBattleAt/endsAt)比较一律用它 */
export function srvNow(): number {
  return Date.now() + offsetMs
}

/** 当前估计的服务端钟差(毫秒;UI 倒计时把本机读数加上它再与服务端戳比较) */
export function srvOffsetMs(): number {
  return offsetMs
}

/** 归零钟差:引擎重登/换号时调用;spec 里也用它隔离用例 */
export function resetSrvClock(): void {
  offsetMs = 0
}
