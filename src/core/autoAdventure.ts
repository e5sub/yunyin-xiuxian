/**
 * 托管择地:VIP 自动历练「去哪一处、走哪一档」的决策,纯函数(不读 store,取值由调用方注入)。
 *
 * 判据只有一条 —— 遇敌胜率。地界越深层级越高、收益越厚,但妖物也越凶;
 * 打不过的一概不入围,绝不为一档收益去吃败仗(败则中断行程、负伤、连胜归零,白耗次数)。
 *
 * 档位两口径:
 *  · 手选档:先试玩家所选,撑不住退到最稳档,连最稳档都站不住便不出行;
 *  · 'auto'(自动选档):把 shortlist 内「全地 × 全档」扫一遍,按
 *    「收益 ≈ 层级 × 奖励倍率」择优 —— 深处的底账厚(层级是收益大头),
 *    同一处里档位越高单程越肥,两维相乘取最大;同分取更深一处。
 *
 * 这样它不会逮着同一处刷到天荒地老,也不会一头扎进打不过的地方反复重伤。
 */
import type { AutoModeChoice, ExploreMode, RegionDef } from '@/types'
import { AUTO_ADVENTURE_MIN_WIN, AUTO_ADVENTURE_SAFE_MODE, AUTO_ADVENTURE_TRIALS, EXPLORE_MODES } from '@/data/constants'

/** 为何选这一处:最深可战 / 退档避险 / 已在最高处 */
export type AutoPlanReason = 'frontier' | 'safer' | 'ceiling'

export interface AutoAdventurePlan {
  regionId: string
  regionName: string
  /** 该地层级(= 收益档) */
  tier: number
  mode: ExploreMode
  /** 该地该档的遇敌胜率(0~1) */
  winRate: number
  reason: AutoPlanReason
}

export interface AutoPlanDeps {
  /** 某地某档的遇敌胜率(0~1);由调用方按实战同源试打得出 */
  rateAt: (region: RegionDef, mode: ExploreMode) => number
  /** 该地之主是否已伏诛(已靖之地再无长进,只能温养) */
  cleared: (regionId: string) => boolean
}

/** 全部档位,按奖励倍率从高到低;自动选档沿这组扫(凶险与奖励同向,档档都得试)。导出给手动指定去处时的单地选档复用 */
export const MODES_BY_REWARD = (Object.keys(EXPLORE_MODES) as ExploreMode[]).sort(
  (a, b) => EXPLORE_MODES[b].rewardMult - EXPLORE_MODES[a].rewardMult
)

/**
 * 挑一处去处。
 * `cands` 须已按层级由深到浅排好(取「最深且站得住」就靠这个序),且都已是此刻能进的。
 */
export function pickAutoPlan(
  cands: readonly RegionDef[],
  preferred: AutoModeChoice,
  deps: AutoPlanDeps
): AutoAdventurePlan | null {
  if (cands.length === 0) return null
  // 深处站不住就退一档试,不必把几十处地界都试一遍:深三处已够说明问题
  const shortlist = cands.slice(0, AUTO_ADVENTURE_TRIALS)

  if (preferred === 'auto') {
    // 自动选档:全地 × 全档扫一遍,按「层级 × 奖励倍率」择优(打不过的不入围)
    let best: { region: RegionDef; mode: ExploreMode; winRate: number; score: number } | null = null
    for (const region of shortlist) {
      for (const mode of MODES_BY_REWARD) {
        const winRate = deps.rateAt(region, mode)
        if (winRate < AUTO_ADVENTURE_MIN_WIN) continue
        const score = region.tier * EXPLORE_MODES[mode].rewardMult
        // 严格大于:同分时保住更深的那处(先到先得,而 shortlist 由深到浅)
        if (best === null || score > best.score) best = { region, mode, winRate, score }
      }
    }
    if (best === null) return null
    return {
      regionId: best.region.id,
      regionName: best.region.name,
      tier: best.region.tier,
      mode: best.mode,
      winRate: best.winRate,
      reason: deps.cleared(best.region.id) ? 'ceiling' : 'frontier'
    }
  }

  const tryMode = (mode: ExploreMode): { region: RegionDef; winRate: number } | null => {
    for (const region of shortlist) {
      const winRate = deps.rateAt(region, mode)
      if (winRate >= AUTO_ADVENTURE_MIN_WIN) return { region, winRate }
    }
    return null
  }

  const chosen = tryMode(preferred)
  const safer = chosen !== null || preferred === AUTO_ADVENTURE_SAFE_MODE ? null : tryMode(AUTO_ADVENTURE_SAFE_MODE)
  const hit = chosen ?? safer
  if (hit === null) return null

  return {
    regionId: hit.region.id,
    regionName: hit.region.name,
    tier: hit.region.tier,
    // 退档避险只在真的换了档时才报 safer
    mode: chosen !== null ? preferred : AUTO_ADVENTURE_SAFE_MODE,
    winRate: hit.winRate,
    reason: chosen === null ? 'safer' : deps.cleared(hit.region.id) ? 'ceiling' : 'frontier'
  }
}
