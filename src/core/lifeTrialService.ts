/**
 * 逆旅契服务:道果的非效率出口。
 *   spendDaoFruit(cost) → reincarnation.trial → lifeTrialRules() 注入本世历练战斗
 *     → 转世时写入 LifeRecord.trialId(履历)
 *
 * 本文件不得出现以下回报(`lifeTrialService.spec.ts` 扫描源码):
 *   - player.addDaoFruit  自供能循环:道果生道果
 *   - player.addInsight   宿慧 → aptitudeFloorNow → growthMult → cultivationSpeed
 *   - 任何资源发放        灵石/丹药 → 强化 → 战力 → 历练更快
 *   - 任何 StatMods       直接落在效率链上
 * 履历是唯一回报,不进任何计算。
 */
import type { CombatRules } from '@/types'
import { type LifeTrialDef, isPurelyAdverse, lifeTrialDef } from '@/data/lifeTrials'
import { usePlayerStore } from '@/stores/player'
import { useUiStore } from '@/stores/ui'

/** 当前这一世的契;未签为 null */
export function activeLifeTrial(): LifeTrialDef | null {
  const t = usePlayerStore().reincarnation.trial
  return t ? (lifeTrialDef(t.trialId) ?? null) : null
}

/** 本世契约施加的战斗规则;未签约时为 undefined */
export function lifeTrialRules(): CombatRules | undefined {
  return activeLifeTrial()?.rules
}

/** 能否签下某契(余额足够、本世尚未签过、规则合法) */
export function canSignLifeTrial(id: string): boolean {
  const player = usePlayerStore()
  if (player.reincarnation.trial) return false
  const def = lifeTrialDef(id)
  if (!def) return false
  if (!isPurelyAdverse(def.rules)) return false
  return player.reincarnation.daoFruit >= def.cost
}

/** 签约还差多少道果 —— 卡面置灰、就地列差与服务拒因共用这一份判据 */
export function lifeTrialShortfall(id: string): number | null {
  const player = usePlayerStore()
  if (player.reincarnation.trial) return null
  const def = lifeTrialDef(id)
  if (!def || !isPurelyAdverse(def.rules)) return null
  const have = player.reincarnation.daoFruit
  return have >= def.cost ? null : def.cost - have
}

/** 签下这一世的逆旅契:一世一份,不可解除(可退款即假消费) */
export function signLifeTrial(id: string): boolean {
  const player = usePlayerStore()
  const ui = useUiStore()
  const def = lifeTrialDef(id)
  if (!def) return false
  if (player.reincarnation.trial) {
    ui.toast('此生已有契在身', 'warn')
    return false
  }
  // 规则不合法则拒签:契约只许加难,这是硬约束
  if (!isPurelyAdverse(def.rules)) return false
  if (!player.spendDaoFruit(def.cost)) {
    const short = lifeTrialShortfall(id)
    ui.toast(short === null ? '道果不足' : `尚差 ${short} 道果`, 'warn')
    return false
  }
  player.setLifeTrial({ trialId: def.id, at: Date.now(), paid: def.cost })
  ui.toast(`「${def.name}」既立,此生再无回头路`, 'rare')
  return true
}

/** 归档本世的契,供 LifeRecord 记录;随后由转世流程清空 */
export function archiveLifeTrial(): string | null {
  return usePlayerStore().reincarnation.trial?.trialId ?? null
}
