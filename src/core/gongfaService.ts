/** 功法服务:参悟 / 习得 / 升级 */
import { rng } from '@/utils/random'
import { GONGFA, gongfaDef } from '@/data/gongfa'
import { qualityDef } from '@/data/qualities'
import { COMPREHEND_PAGE_COST } from '@/data/constants'
import { gongfaAffinity, rootElements } from './linggenAffinity'
import { collect, track } from './progress'
import { usePlayerStore } from '@/stores/player'
import { useResourcesStore } from '@/stores/resources'
import { useCultivationStore } from '@/stores/cultivation'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import { cloudApi, type LevelOpResponse } from '@/services/cloud'
import { playSfx } from './audio'
import { applyLevelSlices, gongfaUpgradeQuote } from './levelResolve'
import {
  gongfaAllLearnedToast,
  gongfaComprehendToast,
  gongfaPageShortToast,
  gongfaUpDoneToast,
  gongfaUpShortToast
} from '@/ui/gongfaText'

/** 随机习得一部功法(事件/掉落),返回功法名;无可学返回 null */
export function learnRandomGongfa(specificId?: string): string | null {
  const player = usePlayerStore()
  const cultivation = useCultivationStore()
  if (specificId) {
    const def = gongfaDef(specificId)
    if (def && cultivation.learn(specificId)) {
      collect('gongfa', specificId)
      track('gongfaLearned')
      return def.name
    }
    return null
  }
  const pool = GONGFA.filter(g => g.minRealm <= player.major + 1 && !cultivation.learned[g.id])
  if (pool.length === 0) return null
  // 同源功法权重更高(倾向,非独占);无对应灵根者权重不变
  const elements = rootElements(player.linggen?.roots)
  const picked = rng.weighted(pool, g => (100 / (1 + qualityDef(g.quality).rank * 1.5)) * gongfaAffinity(g.element, elements))
  cultivation.learn(picked.id)
  collect('gongfa', picked.id)
  track('gongfaLearned')
  return picked.name
}

/** 藏经阁参悟:消耗残页随机习得 */
export function comprehendGongfa(): boolean {
  const resources = useResourcesStore()
  const ui = useUiStore()
  if (!resources.hasSmall('page', COMPREHEND_PAGE_COST)) {
    ui.toast(gongfaPageShortToast(Math.max(0, COMPREHEND_PAGE_COST - resources.page)), 'warn')
    return false
  }
  const player = usePlayerStore()
  const cultivation = useCultivationStore()
  const pool = GONGFA.filter(g => g.minRealm <= player.major + 1 && !cultivation.learned[g.id])
  if (pool.length === 0) {
    ui.toast(gongfaAllLearnedToast(), 'info')
    return false
  }
  resources.spendSmall('page', COMPREHEND_PAGE_COST)
  const name = learnRandomGongfa()
  if (name) {
    ui.toast(gongfaComprehendToast(name), 'rare')
    return true
  }
  return false
}

/** 功法升级消耗(价目在 core/levelResolve,与服务端裁决共用同一份) */
export function gongfaUpgradeCost(id: string): { wudao: number; page: number } | null {
  return gongfaUpgradeQuote(id)
}

/** 本层缺哪一样;付得起为 null */
export function gongfaUpgradeShort(cost: { wudao: number; page: number }): 'wudao' | 'page' | 'both' | null {
  const resources = useResourcesStore()
  const wudao = !resources.hasSmall('wudao', cost.wudao)
  const page = !resources.hasSmall('page', cost.page)
  if (wudao && page) return 'both'
  if (wudao) return 'wudao'
  if (page) return 'page'
  return null
}

/** 本层悟道点与残页的差额;够用为 0 */
export function gongfaUpgradeShortfall(cost: { wudao: number; page: number }): { wudao: number; page: number } {
  const resources = useResourcesStore()
  return {
    wudao: Math.max(0, cost.wudao - resources.wudao),
    page: Math.max(0, cost.page - resources.page)
  }
}

/**
 * 功法进修一层。登录走服务端裁决(POST /api/progress/op,见 core/levelResolve);
 * 未登录走本地同一份纯账层,行为逐字段一致。
 * 服务端回传改动的分片(resources / cultivation),以它为准覆盖本地。
 */
export async function upgradeGongfa(id: string): Promise<boolean> {
  const resources = useResourcesStore()
  const cultivation = useCultivationStore()
  const ui = useUiStore()
  if (useAuthStore().loggedIn) {
    let res: LevelOpResponse | null = null
    try {
      res = await cloudApi.progressOp({
        op: { op: 'gongfaUpgrade', id },
        wudao: resources.wudao,
        page: resources.page
      })
    } catch {
      res = null
    }
    if (res === null) {
      playSfx('warn')
      ui.toast('未能结算', 'warn')
      return false
    }
    if (!res.ok) {
      // 缺料报缺口(按本地余额算差额,与服务端同一套价目);满级/认不出保持安静(按钮本就该禁用)
      const reason = res.reason
      if (reason === 'wudao' || reason === 'page' || reason === 'both') {
        const cost = gongfaUpgradeCost(id)
        if (cost) ui.toast(gongfaUpShortToast(reason, gongfaUpgradeShortfall(cost)), 'warn')
        else playSfx('warn')
      } else {
        playSfx('warn')
      }
      return false
    }
    applyLevelSlices(res.slices)
    const def = gongfaDef(id)
    ui.toast(gongfaUpDoneToast(def?.name ?? '此功', cultivation.learned[id] ?? 0), 'success')
    return true
  }
  const cost = gongfaUpgradeCost(id)
  if (!cost) return false
  const short = gongfaUpgradeShort(cost)
  if (short) {
    ui.toast(gongfaUpShortToast(short, gongfaUpgradeShortfall(cost)), 'warn')
    return false
  }
  resources.spendSmall('wudao', cost.wudao)
  resources.spendSmall('page', cost.page)
  cultivation.upgrade(id)
  const def = gongfaDef(id)
  ui.toast(gongfaUpDoneToast(def?.name ?? '此功', cultivation.learned[id] ?? 0), 'success')
  return true
}
