/** 灵脉服务:总容量 100,主脉 ≤70,副脉各 ≤30;主脉可付费迁移,已投点数不回收 */
import type { GNum } from '@/types'
import type { VeinId } from '@/data/veins'
import { veinDef } from '@/data/veins'
import { VEIN_MAIN_CAPACITY, VEIN_POINT_STONE, VEIN_RESET_STONE, VEIN_SIDE_CAP, VEIN_TOTAL_CAPACITY, VEIN_UNLOCK_MAJOR } from '@/data/constants'
import { stoneByTier } from './formulas'
import { cutGNum } from './spendRate'
import { playerTier } from './progress'
import { formatGN, formatGap } from '@/utils/format'
import { gnZero, gn, mulN, ratio, subClamp } from '@/utils/gnum'
import { playSfx } from './audio'
import { useAuthStore } from '@/stores/auth'
import { cloudApi } from '@/services/cloud'
import { settleLevelRequest } from './settleQueue'
import { usePlayerStore } from '@/stores/player'
import { useDongfuStore } from '@/stores/dongfu'
import { useResourcesStore } from '@/stores/resources'
import { useUiStore } from '@/stores/ui'
import {
  veinBatchDoneToast,
  veinFullToast,
  veinPeakToast,
  veinShortToast,
  veinSwitchDoneToast,
  veinSwitchShortToast
} from '@/ui/veinText'

/** 灵脉是否开放(金丹起) */
export function veinsUnlocked(): boolean {
  return usePlayerStore().major >= VEIN_UNLOCK_MAJOR
}

/** 某条脉当前可投上限 */
export function veinCap(id: VeinId): number {
  const dongfu = useDongfuStore()
  // 未定主脉时按主脉档,须与 veinInvestPlan 的 effectiveCap 同口径
  return dongfu.veinMain === null || dongfu.veinMain === id ? VEIN_MAIN_CAPACITY : VEIN_SIDE_CAP
}

/** 单点投资成本(按玩家当前层级) */
export function veinPointCost(): GNum {
  // VIP 有效期内九折:单投、连投(veinInvestPlan 以它为单价)与服务端价签同读这一处
  return cutGNum(stoneByTier(playerTier(), VEIN_POINT_STONE))
}

export function veinSwitchCost(): GNum {
  return cutGNum(stoneByTier(playerTier(), VEIN_POINT_STONE * 20))
}

/** 灵脉重置的一口价(不随层级走;VIP 九折照常 —— 灵脉本就属修行开销) */
export function veinResetCost(): GNum {
  return cutGNum(gn(VEIN_RESET_STONE))
}

/** 重置还差多少灵石(付得起为 0) */
export function veinResetShortfall(): GNum {
  const cost = veinResetCost()
  const resources = useResourcesStore()
  return resources.hasStone(cost) ? gnZero() : subClamp(cost, resources.spiritStone)
}

/** 改立主脉还差多少灵石(付得起为 0);入口、确认钮与服务拒因同读此处 */
export function veinSwitchShortfall(): GNum {
  const cost = veinSwitchCost()
  const resources = useResourcesStore()
  return resources.hasStone(cost) ? gnZero() : subClamp(cost, resources.spiritStone)
}

/** 单点投脉还差多少灵石(付得起为 0);单点、连投与服务拒因同读此处 */
export function veinPointShortfall(): GNum {
  const cost = veinPointCost()
  const resources = useResourcesStore()
  return resources.hasStone(cost) ? gnZero() : subClamp(cost, resources.spiritStone)
}

/** 向某条脉投一点;未定主脉时首投之脉成为主脉 */
export function investVein(id: VeinId): boolean {
  const dongfu = useDongfuStore()
  const resources = useResourcesStore()
  const ui = useUiStore()
  if (!veinsUnlocked()) return false

  if (dongfu.veinTotal >= VEIN_TOTAL_CAPACITY) {
    ui.toast(veinFullToast(), 'warn')
    return false
  }
  const current = dongfu.veinPoints[id] ?? 0
  if (current >= veinCap(id)) {
    ui.toast(veinPeakToast(dongfu.veinMain === id), 'warn')
    return false
  }
  const cost = veinPointCost()
  if (!resources.hasStone(cost)) {
    ui.toast(veinShortToast(formatGap(veinPointShortfall())), 'warn')
    return false
  }
  // 立主须在全部守卫之后:被拒的点击不得占主脉
  if (dongfu.veinMain === null) dongfu.setVeinMain(id)
  resources.spendStone(cost)
  dongfu.addVeinPoint(id, 1)
  return true
}

export interface VeinInvestPlan {
  /** 还能一口气连投的点数(该脉上限、总容量与灵石三者取小) */
  points: number
  /** 连投总耗的灵石 */
  stone: GNum
  /** points=0 时的原因:满却 / 总容量尽 / 灵石不足 */
  blocked: 'peak' | 'full' | 'short' | null
}

/** 连投计划,只算不动手;单点成本不随点数涨,总价 = 点数 × 单价;未定主脉按主脉档算余量 */
export function veinInvestPlan(veinId: VeinId): VeinInvestPlan {
  const dongfu = useDongfuStore()
  const resources = useResourcesStore()
  const zero = (blocked: VeinInvestPlan['blocked']): VeinInvestPlan => ({ points: 0, stone: gnZero(), blocked })
  if (!veinsUnlocked()) return zero(null)
  const current = dongfu.veinPoints[veinId] ?? 0
  if (dongfu.veinTotal >= VEIN_TOTAL_CAPACITY) return zero('full')
  const effectiveCap = dongfu.veinMain === null || dongfu.veinMain === veinId ? VEIN_MAIN_CAPACITY : VEIN_SIDE_CAP
  if (current >= effectiveCap) return zero('peak')
  const maxByCap = Math.min(effectiveCap - current, VEIN_TOTAL_CAPACITY - dongfu.veinTotal)
  if (maxByCap <= 0) return zero('peak')
  const byStone = Math.floor(ratio(resources.spiritStone, veinPointCost()))
  // 单价为 0/NaN 时 ratio 回 Infinity/NaN:按 maxByCap 取,不让 Infinity 进 plan
  const points = Math.min(maxByCap, Number.isFinite(byStone) ? byStone : maxByCap)
  if (points <= 0) return zero('short')
  return { points, stone: mulN(veinPointCost(), points), blocked: null }
}

/**
 * 连投:按 veinInvestPlan 总账一笔扣、一笔加,计划与执行间无 await;逐点累加有 GNum 尾差,与预览对不齐。
 * 返回实际投的点数,0 = 一注未成。
 */
export function investVeinBatch(veinId: VeinId): number {
  const dongfu = useDongfuStore()
  const resources = useResourcesStore()
  const ui = useUiStore()
  const plan = veinInvestPlan(veinId)
  if (plan.points === 0) {
    if (plan.blocked === 'full') ui.toast(veinFullToast(), 'warn')
    else if (plan.blocked === 'peak') ui.toast(veinPeakToast(dongfu.veinMain === veinId), 'warn')
    else ui.toast(veinShortToast(formatGap(veinPointShortfall())), 'warn')
    playSfx('warn')
    return 0
  }
  // 未定主脉时与单点同规则立主
  if (dongfu.veinMain === null) dongfu.setVeinMain(veinId)
  resources.spendStone(plan.stone)
  dongfu.addVeinPoint(veinId, plan.points)
  playSfx('success')
  ui.toast(veinBatchDoneToast(veinDef(veinId).name, plan.points, formatGN(plan.stone)), 'success')
  return plan.points
}

/** 迁移主脉:付费换向;原主脉点数保留(超出副脉上限的部分不再可投,但效果不失) */
export function switchMainVein(id: VeinId): boolean {
  const dongfu = useDongfuStore()
  const resources = useResourcesStore()
  const ui = useUiStore()
  if (!veinsUnlocked() || dongfu.veinMain === id) return false
  const cost = veinSwitchCost()
  const gap = veinSwitchShortfall()
  if (gap.m > 0) {
    playSfx('warn')
    ui.toast(veinSwitchShortToast(formatGap(gap)), 'warn')
    return false
  }
  resources.spendStone(cost)
  dongfu.setVeinMain(id)
  playSfx('success')
  ui.toast(veinSwitchDoneToast(veinDef(id).name), 'success')
  return true
}

/* ---------------- 登录态入口(1.67.0 收进服务端) ---------------- */
/*
 * 为什么投点也要上服务端:veinPoints 既进服务端算价(levelResolve 的 gongfaUpgradeQuote 读
 * dongfu.insightDiscount 折悟道点),又是采集加成与祭炼折扣的底数 —— 此前没有任何台账,
 * 改档把 100 点写满就不必花那 100 份灵石,而且服务端还会按折扣价记账。
 * 现在点数记进 level_state(kind='vein'),上传时按台账压回;价目与上限判据两端共用本文件的函数。
 */
function veinRejectToast(id: VeinId, reason: string | undefined): void {
  const dongfu = useDongfuStore()
  const ui = useUiStore()
  playSfx('warn')
  if (reason === 'max') {
    // 「满却」与「总容量尽」是两句不同的话:前者这条脉到顶,后者是 100 点都投完了
    if ((dongfu.veinPoints[id] ?? 0) >= veinCap(id)) ui.toast(veinPeakToast(dongfu.veinMain === id), 'warn')
    else ui.toast(veinFullToast(), 'warn')
    return
  }
  if (reason === 'realm') return
  ui.toast(veinShortToast(formatGap(veinPointShortfall())), 'warn')
}

/** 投一点;成功不噪(面板数字自己会动),失败照本地链那套文案 */
export async function requestVeinInvest(id: VeinId): Promise<boolean> {
  if (!useAuthStore().loggedIn) return investVein(id)
  const resources = useResourcesStore()
  // 余额在闸内读、分片在闸内覆盖(1.74.0):连投与炼器撞在一起时不会按同一份旧余额各要额度
  const res = await settleLevelRequest(() =>
    cloudApi.progressOp({
      op: { op: 'veinInvest', id, points: 1 },
      stone: resources.spiritStone
    })
  )
  if (res === null) {
    playSfx('warn')
    useUiStore().toast('未能结算', 'warn')
    return false
  }
  if (!res.ok) {
    veinRejectToast(id, res.reason)
    return false
  }
  return true
}

/** 连投;返回实际投出的点数(0 = 一注未成) */
export async function requestVeinBatch(id: VeinId): Promise<number> {
  if (!useAuthStore().loggedIn) return investVeinBatch(id)
  const resources = useResourcesStore()
  const res = await settleLevelRequest(() =>
    cloudApi.progressOp({
      op: { op: 'veinInvest', id, points: 0 },
      stone: resources.spiritStone
    })
  )
  const ui = useUiStore()
  if (res === null) {
    playSfx('warn')
    ui.toast('未能结算', 'warn')
    return 0
  }
  if (!res.ok) {
    veinRejectToast(id, res.reason)
    return 0
  }
  const points = res.detail?.levels ?? 0
  const stone = res.spend?.stone
  playSfx('success')
  ui.toast(veinBatchDoneToast(veinDef(id).name, points, formatGN(stone ?? gnZero())), 'success')
  return points
}

/* ---------------- 灵脉重置(1.74.1) ---------------- */

/**
 * 灵脉重置:四脉点数全数归零、主脉归还,一口价 VEIN_RESET_STONE(VIP 九折照常)。
 * 与投点同一条服务端账(levelResolve 的 veinReset):登录态走 /api/progress/op,
 * 服务端按台账清空 vein 行 —— 台账只升不降,不清的话上传一次旧点数又被顶回来。
 * 本地(未登录)直接动手:重置不动任何服务端算价输入以外的账,spendStone 走本地结算。
 */
export async function requestVeinReset(): Promise<boolean> {
  const ui = useUiStore()
  const gap = veinResetShortfall()
  if (gap.m > 0) {
    playSfx('warn')
    ui.toast(`灵石尚差 ${formatGap(gap)},重不成`, 'warn')
    return false
  }
  if (!useAuthStore().loggedIn) {
    const resources = useResourcesStore()
    const dongfu = useDongfuStore()
    if (dongfu.veinTotal <= 0) return false
    resources.spendStone(veinResetCost())
    dongfu.resetVeins()
    playSfx('success')
    ui.toast('灵脉已重置 · 四脉归零,再投时首投成主', 'success')
    return true
  }
  const resources = useResourcesStore()
  const res = await settleLevelRequest(() =>
    cloudApi.progressOp({
      op: { op: 'veinReset' },
      stone: resources.spiritStone
    })
  )
  if (res === null) {
    playSfx('warn')
    ui.toast('未能结算', 'warn')
    return false
  }
  if (!res.ok) {
    playSfx('warn')
    // 拒因就三种:境界未到 / 一点未投 / 灵石不足 —— 前两种照实说,不足报差额
    if (res.reason === 'stone') ui.toast(`灵石尚差 ${formatGap(veinResetShortfall())},重不成`, 'warn')
    else if (res.reason === 'realm') ui.toast('灵脉尚未开放', 'warn')
    else ui.toast('尚未投点,无从重置', 'warn')
    return false
  }
  playSfx('success')
  ui.toast('灵脉已重置 · 四脉归零,再投时首投成主', 'success')
  return true
}
