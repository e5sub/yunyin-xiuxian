import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { usePlayerStore } from '@/stores/player'
import { REGIONS, maxTierForMajor } from '@/data/regions'
import { rollLinggen } from '@/core/linggenGen'
import { checkSuppression, settleSuppressedRegions, suppressionProgress } from './suppress'
import { FLOURISH_WINS, STABLE_WINS, regionRecallFor, regionWinsOfThisLife } from './worldMemory'
import { rng } from '@/utils/random'

/**
 * 转世 × 镇压:镇压权益随转世清空,区域回到历练地;宿敌与区域战绩(regionStats)跨世保留。
 * 读档残留判据是世号(player.suppressLife),不是境界:进入某地不受 minRealm 管,本世可在境界低于标称时镇压。
 * 老档(无世号)按境界代理(minRealm > 当前境界)清一次,随后补盖世号。
 */
describe('转世不残留产出型镇压', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('新世(重掷后 major=0)能压的区域上限只到 2 阶 —— 远阶当属「重新经历」', () => {
    expect(maxTierForMajor(0)).toBe(2)
  })

  it('转世后,上一世镇压的远境应已复聚:结算不再为其派发装备', () => {
    const player = usePlayerStore()
    const far = REGIONS.filter(r => r.tier >= 20)[0]!
    player.suppressRegion(far.id)
    expect(player.suppressedRegions).toContain(far.id)

    player.rebirth(rollLinggen(rng))

    expect(player.suppressedRegions).not.toContain(far.id)

    const got = settleSuppressedRegions(3 * 3600, rng)
    expect(got).toBeNull()
  })

  it('宿敌与区域战绩是「我是谁」,仍随神魂不灭(转世不清)', () => {
    const player = usePlayerStore()
    player.suppressRegion('qingyun')
    player.setNemeses([
      { enemyId: 'e_wolf', enemyName: '苍狼', regionId: 'qingyun', lossCount: 3, lastLossAt: Date.now() }
    ])
    player.rebirth(rollLinggen(rng))
    expect(player.nemeses.length).toBe(1)
    expect(player.suppressedRegions).toHaveLength(0)
    expect(Object.keys(player.suppressedSince)).toHaveLength(0)
    expect(player.suppressQualified).toHaveLength(0)
  })

  it('老档兜底:修复前已转世的存档,读档时远境镇压照清(不然还得再转一次世)', () => {
    const player = usePlayerStore()
    // 老档:suppressLife 为哨兵 −1,带 20+ 阶远境镇压
    const far = REGIONS.filter(r => r.tier >= 20)[0]!
    expect(player.suppressLife, '新档默认是哨兵,读档后才补盖世号').toBe(-1)
    player.suppressedRegions = [far.id, 'qingyun']
    player.suppressQualified = [far.id, 'qingyun']
    player.suppressedSince = { [far.id]: 12345, qingyun: 67890 }
    player.sanitize()
    // 老档按境界判:境界 0 下 20 阶远境清掉,qingyun(minRealm 0)保留
    expect(player.suppressedRegions).toEqual(['qingyun'])
    expect(player.suppressQualified).toEqual(['qingyun'])
    expect(Object.keys(player.suppressedSince)).toEqual(['qingyun'])
    // 清完补盖世号,此后按世号判
    expect(player.suppressLife).toBe(player.reincarnation.count)
  })

  it('读档兜底只对老档:中期存档(境界高)里合法的远境镇压原样保留', () => {
    const player = usePlayerStore()
    // 境界 8 的老档:minRealm ≤ 8 的远境合法,不清
    player.major = 8
    const far = REGIONS.filter(r => r.tier >= 20)[0]!
    expect(far.minRealm).toBeLessThanOrEqual(8)
    player.suppressedRegions = [far.id]
    player.suppressQualified = [far.id]
    player.sanitize()
    expect(player.suppressedRegions).toEqual([far.id])
    expect(player.suppressQualified).toEqual([far.id])
    // minRealm > 8 的仍清:老档分不出本世/旧世
    const impossibleId = REGIONS.filter(r => r.minRealm > 8)[0]!.id
    player.suppressLife = -1 // 复位老档哨兵:境界判据只在无世号时走
    player.suppressedRegions = [far.id, impossibleId]
    player.suppressedSince = { [far.id]: 1, [impossibleId]: 2 }
    player.sanitize()
    expect(player.suppressedRegions).toEqual([far.id])
  })

  it('本世镇压的高境副本读档不被境界判据没收(判据是世号,不是境界)', () => {
    const player = usePlayerStore()
    player.major = 0
    const far = REGIONS.filter(r => r.tier >= 20)[0]!
    expect(far.minRealm).toBeGreaterThan(0)
    player.suppressRegion(far.id)
    expect(player.suppressedRegions).toEqual([far.id])

    player.sanitize()
    expect(player.suppressedRegions, '本世的地盘不因境界低被没收').toEqual([far.id])
    expect(player.suppressLife).toBe(player.reincarnation.count)
  })

  it('转世后旧世镇压清空且世号跟上:判据换成世号后仍不残留', () => {
    const player = usePlayerStore()
    const far = REGIONS.filter(r => r.tier >= 20)[0]!
    player.suppressRegion(far.id)
    player.rebirth(rollLinggen(rng))
    expect(player.suppressedRegions, '转世即放下地盘').toEqual([])
    expect(player.suppressLife, '世号随转世前进').toBe(player.reincarnation.count)
    player.sanitize()
    expect(player.suppressedRegions).toEqual([])
  })

  /**
   * rebirth() 清空 suppressQualified,历练页文案须写资格限本世。
   * 故障注入:把文案改回「资格永久,守满…」,本条红。
   */
  it('历练页不再承诺「资格永久」,并写明资格限本世', () => {
    const view = readFileSync(resolve(__dirname, '../views/AdventureView.vue'), 'utf8')
    expect(view, '资格只在本世内有效,必须点明限于本世').toContain('资格限本世')
    expect(view, '不许再对玩家承诺跨世的「资格永久」').not.toContain('资格永久,守满')

    // 正对照:本世保留、转世清空
    const player = usePlayerStore()
    player.markSuppressQualified('qingyun')
    player.suppressRegion('qingyun')
    expect(player.suppressQualified, '本世内资格照旧保留').toContain('qingyun')
    player.rebirth(rollLinggen(rng))
    expect(player.suppressQualified, '转世后资格随皮囊散去').toEqual([])
  })

  /**
   * regionStats 跨世保留,镇压判据只认本世战绩;否则新世赢一场即可凭旧世 EMA 重新镇压高阶地界。
   * 故障注入:删掉 suppressionProgress 的 life 判据,本条红。
   */
  it('转世后旧世战绩不再替新世作证:赢一场不会重新镇压高阶地界', () => {
    const player = usePlayerStore()
    player.major = 12
    player.regionStats.hongmeng = {
      totalFights: 30,
      avgRounds: 2,
      avgDamageTakenPct: 0.03,
      consecutiveWins: 30,
      lastUpdateAt: Date.now()
    }
    player.markSuppressQualified('hongmeng')
    player.suppressRegion('hongmeng')
    expect(player.suppressedRegions).toEqual(['hongmeng'])

    player.rebirth(rollLinggen(rng))
    player.updateRegionStats('hongmeng', true, 2, 0.03)
    expect(player.regionStats.hongmeng!.totalFights, '本世战绩从 1 起算').toBe(1)
    expect(checkSuppression(player, 'hongmeng'), '旧世战绩不该替新世作证').toBe(false)

    // 阳性对照:本世满 20 胜
    for (let i = 0; i < 19; i += 1) player.updateRegionStats('hongmeng', true, 2, 0.03)
    expect(player.regionStats.hongmeng!.totalFights).toBe(20)
    expect(checkSuppression(player, 'hongmeng'), '本世攒够就该能镇压').toBe(true)
  })

  it('跨世战绩保留原世号,不被读档改写成当前世', () => {
    const player = usePlayerStore()
    player.major = 12
    player.regionStats.hongmeng = {
      totalFights: 30,
      avgRounds: 2,
      avgDamageTakenPct: 0.03,
      consecutiveWins: 30,
      lastUpdateAt: Date.now(),
      life: player.reincarnation.count
    }
    player.rebirth(rollLinggen(rng))
    player.sanitize()
    expect(player.regionStats.hongmeng!.life, '旧世战绩不该被读档洗成本世').toBe(0)
    expect(player.regionStats.hongmeng!.totalFights).toBe(30)
    expect(suppressionProgress(player.regionStats.hongmeng, player.suppressLife).qualified, '旧账不参与本世判据').toBe(false)
  })

  /**
   * suppressedSince 是兴衰、装备气运与 72 小时复聚钟的共同起点;停取再切回不得重置。
   * 故障注入:把 unsuppressRegion 里的 delete 放回,本条红。
   */
  it('停取收益再切回,守土起点不重置(兴衰、气运、复聚钟都不白拿)', () => {
    const player = usePlayerStore()
    const t = Date.now() - 48 * 3600_000
    player.markSuppressQualified('qingyun')
    player.suppressRegion('qingyun')
    player.suppressedSince = { qingyun: t }

    player.unsuppressRegion('qingyun')
    expect(player.suppressedSince.qingyun, '停取只是关产出,不是「没守过」').toBe(t)

    player.suppressRegion('qingyun')
    expect(player.suppressedSince.qingyun, '切回来不该把守了两天重置成 0').toBe(t)
  })

  /**
   * sanitize 保留仍在镇压或仍持有资格的起点。
   * 故障注入:把遍历改回只走 suppressedRegions,本条红。
   */
  it('停取收益后读档,守土起点仍保留;资格与起点都没了才算残项', () => {
    const player = usePlayerStore()
    const t = Date.now() - 48 * 3600_000
    player.markSuppressQualified('qingyun')
    player.suppressRegion('qingyun')
    player.suppressedSince = { qingyun: t }
    player.unsuppressRegion('qingyun')

    player.sanitize()
    expect(player.suppressedSince.qingyun, '有资格就留着起点').toBe(t)
    expect(player.suppressQualified).toContain('qingyun')

    // 反向:无资格的残项,起点丢掉
    player.suppressQualified = []
    player.sanitize()
    expect(player.suppressedSince.qingyun, '资格与镇压都没有了,起点才是真残项').toBeUndefined()
  })

  /**
   * regionWins 跨世保留,兴衰只认本世胜场。
   * 故障注入:让 regionWinsOfThisLife 忽略世号,本条红。
   */
  it('新世镇压地界不再继承旧世胜场:兴衰从混乱重新走', () => {
    const player = usePlayerStore()
    player.major = 12
    player.regionWins = { hongmeng: FLOURISH_WINS }
    player.regionWinsLife = { hongmeng: 0 }
    player.markSuppressQualified('hongmeng')
    player.suppressRegion('hongmeng')
    expect(regionRecallFor('hongmeng').prosperity, '上一世确实繁盛').toBe('flourish')

    player.rebirth(rollLinggen(rng))
    expect(regionWinsOfThisLife(player, 'hongmeng'), '新世本世胜场从 0 起').toBe(0)
    player.markSuppressQualified('hongmeng')
    player.suppressRegion('hongmeng')
    expect(regionRecallFor('hongmeng').prosperity, '新世一场未打,不该直接繁盛').toBe('chaos')

    // 阳性对照:本世胜场够数即翻档
    player.regionWins = { ...player.regionWins, hongmeng: STABLE_WINS }
    player.regionWinsLife = { ...player.regionWinsLife, hongmeng: player.suppressLife }
    expect(regionRecallFor('hongmeng').prosperity).toBe('stable')
  })
})
