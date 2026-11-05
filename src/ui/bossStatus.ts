/**
 * 妖王 / 副本首领的战况文案(1.59.2):万妖围城的妖王牌与多人副本的首领战况共用这一套口径。
 *
 * 副本战报是逐行文字,心魔战还把后六轮折成「……」——只读日志判不出有没有斩杀、更看不到余血;
 * 围妖的主牌虽有血条,却只报「气血 X / Y」,没有百分比,打完一剑也不知道削到了几成。
 * 服务端把战况结出来,这里负责翻成人话,组件只负责画。
 */
import type { BossStrikeResult, DungeonBossReport } from '@/services/cloud'
import { gn } from '@/utils/gnum'
import { formatGN } from '@/utils/format'

/** 一块战况所需的最小形状:副本的 BossReport 与围妖的战后结算都折成它 */
export interface BossStatusView {
  name: string
  /** 起初气血(文本) */
  hpStart: string
  /** 剩余气血(文本;击破时为 0) */
  hpLeft: string
  /** 剩余百分比 0~100 */
  leftPct: number
  killed: boolean
  /** 战至第几轮/波;空串则不显示(围妖固定十回合,已写在战报正文) */
  roundText: string
}

/** 状态徽章:已击破 / 未破(余 N%) */
export function bossBadgeText(v: BossStatusView): string {
  return v.killed ? '已击破' : `未破 · 余 ${bossBarWidth(v)}%`
}

/** 血条填充宽度(%):击破后留空条,未破按剩余占比;脏值(含 NaN/Infinity)夹回 0~100 */
export function bossBarWidth(v: BossStatusView): number {
  if (v.killed) return 0
  const pct = v.leftPct
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return 0
  return Math.max(0, Math.min(100, pct))
}

/** 气血一行:「余 1.2万 / 起初 3.6万」 */
export function bossHpText(v: BossStatusView): string {
  return `余 ${v.hpLeft} / 起初 ${v.hpStart}`
}

/** 战报里的「战后」一句:有没有破、剩多少,一句话说完(句子前面的「战后」由调用方给) */
export function bossAfterText(v: BossStatusView): string {
  return v.killed ? `已击破(起初气血 ${v.hpStart})` : `气血 ${v.hpLeft} / ${v.hpStart}(余 ${v.leftPct}%)`
}

/**
 * 剩余占比(%):GNum 比值,差三个数量级以上直接按满/空计,
 * 免得 1e40 对 1e3 这种比法把百分比算成天文数字。四舍五入留给显示。
 */
export function hpSharePct(part: { m: number; e: number }, full: { m: number; e: number }): number {
  const a = gn(part)
  const b = gn(full)
  if (b.m <= 0) return 0
  const diff = a.e - b.e
  if (diff > 3) return 100
  if (diff < -3) return 0
  const pct = (a.m / b.m) * Math.pow(10, diff) * 100
  if (!Number.isFinite(pct)) return 0
  return Math.max(0, Math.min(100, Math.round(pct)))
}

/** 轮次口径:守卫数「波」,斗法数「轮」 */
function unitText(unit: 'round' | 'wave'): string {
  return unit === 'wave' ? '波' : '轮'
}

/** 多人副本服务端结出的 boss → 战况视图 */
export function dungeonBossView(b: DungeonBossReport): BossStatusView {
  return {
    name: b.name,
    hpStart: b.hpStart,
    hpLeft: b.hpLeft,
    leftPct: b.leftPct,
    killed: b.killed,
    roundText: `第 ${b.rounds}/${b.roundsTotal} ${unitText(b.unit)}`
  }
}

/** 围妖一剑之后的战况视图(妖王固定十回合,不报轮次) */
export function bossStrikeView(r: BossStrikeResult): BossStatusView {
  const start = gn(r.maxHp)
  const left = r.killed ? { m: 0, e: 0 } : gn(r.hp)
  return {
    name: r.bossName,
    hpStart: formatGN(start),
    hpLeft: formatGN(left),
    leftPct: hpSharePct(left, start),
    killed: r.killed,
    roundText: ''
  }
}

/**
 * 道友提示尾巴:队友只收到一行 ws 提示,看不到完整战报,
 * 所以把「首领死没死」压进这半句里(老服务端不带 boss 字段时为空串)。
 */
export function dungeonShareTail(b: DungeonBossReport | null | undefined): string {
  if (b === null || b === undefined) return ''
  return ` · ${b.name}${b.killed ? '已破' : `余 ${b.leftPct}%`}`
}
