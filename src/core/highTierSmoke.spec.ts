/** 高界战斗/掉落冒烟:新界域各取高层地界真跑敌人快照与掉落结算,抓数据审计看不出的阈值越界、NaN、掉落池空 */
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { makeEnemySnap } from './combat'
import { afterWin } from './loot'
import { regionDef } from '@/data/regions'
import { enemyDef } from '@/data/enemies'
import { toNum } from '@/utils/gnum'
import { useResourcesStore } from '@/stores/resources'
import { usePlayerStore } from '@/stores/player'
import { useEndgameStore } from '@/stores/endgame'
import { settleSuppressedRegions } from './suppress'
import { enterSecretRealm, entryCostOf, fightSecretLayer, availableRealms } from './secretRealm'

/** 仙界/神界/混沌海各取两处,覆盖同层正区与第二处地界 */
const HIGH_REGIONS = ['yunhai', 'zhexian', 'jinyuan', 'shenjihuang', 'guji', 'hongmengbenyuan', 'wudaoya'] as const

describe('高界冒烟 · 敌人快照与掉落结算', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('新界各层地界的敌人快照数值有限且为正', () => {
    for (const rid of HIGH_REGIONS) {
      const region = regionDef(rid)
      expect(region, `样本地界 ${rid} 不存在`).toBeDefined()
      const ids = [...region!.enemies, region!.boss]
      for (const id of ids) {
        const def = enemyDef(id)
        expect(def, `${rid} 引用了不存在的敌人 ${id}`).toBeDefined()
        const snap = makeEnemySnap(def!, region!.tier, 1)
        for (const [k, v] of Object.entries({
          attack: toNum(snap.attack),
          defense: toNum(snap.defense),
          maxHp: toNum(snap.maxHp),
          speed: snap.speed
        })) {
          expect(Number.isFinite(v), `${def!.name} 的 ${k} 非有限值`).toBe(true)
          expect(v, `${def!.name} 的 ${k} 非正`).toBeGreaterThan(0)
        }
        expect(snap.skills.length, `${def!.name} 没有招式`).toBeGreaterThan(0)
      }
    }
  })

  it('新界各层地界都能真的结算出战斗奖励(灵石/修为有增、文案非空、无 NaN)', () => {
    for (const rid of HIGH_REGIONS) {
      const region = regionDef(rid)!
      const resources = useResourcesStore()
      const player = usePlayerStore()
      const stoneBefore = toNum(resources.spiritStone)
      const expBefore = toNum(player.exp)
      const drops = afterWin(region, 1, true)
      expect(drops.lines.length, `${region.name} 战利品文案为空`).toBeGreaterThan(0)
      expect(toNum(resources.spiritStone), `${region.name} 灵石未增加`).toBeGreaterThan(stoneBefore)
      expect(toNum(player.exp), `${region.name} 修为未增加`).toBeGreaterThan(expBefore)
      expect(Number.isFinite(toNum(resources.spiritStone))).toBe(true)
    }
  })
})

/** 镇压产出与天界秘境:百万级数值下才暴露 NaN / 负值 / 空掉落池 */
describe('高界冒烟 · 镇压产出与天界秘境', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('镇压神界/混沌海的地界:产出有限、非负、材料名目有效', () => {
    const player = usePlayerStore()
    const resources = useResourcesStore()
    // 神界、混沌海各一处,守 6 小时(避开 72h 复苏判定)
    const ids = ['shenjihuang', 'hongmengbenyuan']
    for (const id of ids) {
      player.suppressRegion(id)
      player.suppressQualified.push(id)
    }
    const before = toNum(resources.spiritStone)
    const out = settleSuppressedRegions(6 * 3600)
    expect(out, '镇压产出不该为空').not.toBeNull()
    expect(Number.isFinite(toNum(out!.stone))).toBe(true)
    expect(toNum(out!.stone)).toBeGreaterThan(0)
    expect(toNum(resources.spiritStone)).toBeGreaterThan(before)
    for (const r of out!.resources) {
      expect(['herb', 'ore', 'page', 'dust', 'wudao']).toContain(r.id)
      expect(Number.isFinite(r.amount), `${r.name} 产出非有限值`).toBe(true)
      expect(r.amount).toBeGreaterThan(0)
    }
    expect(Number.isFinite(out!.recycledDust)).toBe(true)
  })

  it('天界秘境:付道源、三层走完、战利有限且真的到手', () => {
    const player = usePlayerStore()
    const resources = useResourcesStore()
    const endgame = useEndgameStore()
    player.major = 9
    endgame.daoPath = 'sword'
    endgame.addDaoSource(500)
    const def = availableRealms('celestial')[0]!
    const cost = entryCostOf(def, 9)
    expect(cost.kind).toBe('daoSource')
    const before = endgame.daoSource
    expect(enterSecretRealm(def.id).ok).toBe(true)
    expect(endgame.daoSource).toBe(before - (cost.kind === 'daoSource' ? cost.daoSource : 0))

    const stoneBefore = toNum(resources.spiritStone)
    let guard = 0
    while (guard < 10) {
      const r = fightSecretLayer()
      if (!r) break
      guard += 1
      for (const line of r.lines) expect(line).not.toContain('NaN')
    }
    expect(Number.isFinite(toNum(resources.spiritStone))).toBe(true)
    // 打到底(通关或被逐出)必发生过结算
    expect(guard).toBeGreaterThan(0)
    expect(toNum(resources.spiritStone)).toBeGreaterThanOrEqual(stoneBefore)
  })
})
