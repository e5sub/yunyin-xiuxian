import { computed } from 'vue'
import type { FoeOrigin, RegionDef } from '@/types'
import type { WorldDef } from '@/data/realms'
import { REGIONS } from '@/data/regions'
import { worldOf } from '@/data/realms'
import { useAdventureStore } from '@/stores/adventure'
import { usePlayerStore } from '@/stores/player'
import { canEnterRegion, entryBlockReason } from '@/core/mortalWorldService'
import { regionBossCleared, regionFoeOrigin } from '@/core/exploration'
import { currentLifeOf, suppressionProgress, type SuppressionProgress } from '@/core/suppress'
import { detectBuild } from '@/core/buildDetect'
import {
  detectionAdaptation,
  ecologyChips,
  regionEcology,
  type Adaptation,
  type EcoLevel,
  type EcoTrait
} from '@/core/buildAdvisor'

/**
 * 一行地界的全部事实:区域卡、分组与「可见到哪一处」共用这一份投影。
 * 时间相关列(复聚倒计时、已守时长)不进本表,读 `now` 会让整表随秒针重算。
 */
export interface RegionRow {
  def: RegionDef
  unlocked: boolean
  canEnter: boolean
  blockReason: string | null
  cleared: boolean
  suppressed: boolean
  revived: boolean
  qualified: boolean
  progress: SuppressionProgress
  tooHard: boolean
  foeOrigin: FoeOrigin
  chips: { trait: EcoTrait; name: string; level: EcoLevel }[]
  adaptation: Adaptation | null
}

/**
 * 历练页的地界投影与分组。
 * `visibleRows` 截断须带上 `canEnter`:本世路线首段可能排在表靠后,只按「已发现」截断会把它挡在可见范围外。
 */
export function useRegionRows() {
  const adventure = useAdventureStore()
  const player = usePlayerStore()

  const currentBuild = computed(() => detectBuild(player.finalStats.mods))

  const regionRows = computed<RegionRow[]>(() =>
    REGIONS.map(r => {
      const eco = regionEcology(r)
      const suppressed = player.suppressedRegions.includes(r.id)
      /**
       * 妖气复聚读落盘的世界状态(core/regionRevival 写 adventure.revived),不拿 `isReviving` 现算:
       * 复聚只发生在已靖地界,镇压满 72 小时只是松开镇压。
       */
      const revived = adventure.revived.includes(r.id)
      return {
        def: r,
        // 是否已被发现:只参与列表可见性截断
        unlocked: adventure.unlocked.includes(r.id),
        // 此刻能否进去:决定出发按钮。须与「已发现」分开,拿准入当可见性会把后面能进的地界一并藏掉
        canEnter: canEnterRegion(r.id),
        blockReason: entryBlockReason(r.id),
        cleared: regionBossCleared(r.id),
        suppressed,
        revived,
        /** 是否取得过镇压资格(本世取得即永久,转世散去) */
        qualified: player.suppressQualified.includes(r.id),
        /** 镇压资格进度(三条判据的当前值/阈值);与 checkSuppression 同判,旧世战绩不计 */
        progress: suppressionProgress(player.regionStats[r.id], currentLifeOf(player)),
        tooHard: r.minRealm > player.major,
        /** 此地之敌的加成来源(层级补偿 × 地界凶险;出行方式那一档另算) */
        foeOrigin: regionFoeOrigin(r),
        // 只留最强的两个生态标签
        chips: ecologyChips(eco).slice(0, 2),
        adaptation: currentBuild.value ? detectionAdaptation(currentBuild.value, eco) : null
      }
    })
  )

  const visibleRows = computed(() => {
    const rows = regionRows.value
    const firstLocked = rows.findIndex(r => !r.unlocked && !r.canEnter)
    return firstLocked < 0 ? rows : rows.slice(0, firstLocked + 1)
  })

  /** 按界域分组(人间界/仙界/神界/混沌海各成一段);展示序倒序,新解锁的排最上,截断仍按数据序 */
  const groupedRows = computed(() => {
    const groups: { world: WorldDef; rows: RegionRow[] }[] = []
    for (const row of [...visibleRows.value].reverse()) {
      const world = worldOf(row.def.minRealm)
      const hit = groups.find(g => g.world.id === world.id)
      if (hit) hit.rows.push(row)
      else groups.push({ world, rows: [row] })
    }
    return groups
  })

  return { currentBuild, regionRows, groupedRows }
}
