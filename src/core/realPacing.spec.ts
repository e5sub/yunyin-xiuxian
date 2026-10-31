/* eslint-disable no-console -- 输出真实档对账表 */
/**
 * 真实档节奏对账:满配真实档 ≤ progressionSim 模型 ≤ 裸档真实档,两端都走真实 store 通路。
 * 实测(境界 9→20):满配约为模型的 0.73~0.86,裸档约为模型的 3.0~4.5。
 * 故障注入:把模型的 kit 假设抬到满配之上(如功法给 5.0),左侧红;把 kit 假设清空,右侧红。
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { MAX_MAJOR, WORLD_BREAK_MAJOR } from '@/data/realms'
import { SUB_LEVELS } from '@/data/constants'
import { toNum } from '@/utils/gnum'
import { expRequirement } from './formulas'
import { secondsForMajor } from './progressionSim'
import { usePlayerStore } from '@/stores/player'
import { useCultivationStore } from '@/stores/cultivation'
import { useDongfuStore } from '@/stores/dongfu'
import { useResourcesStore } from '@/stores/resources'
import { GONGFA } from '@/data/gongfa'
import { GONGFA_BRANCHES } from '@/data/gongfaBranches'
import { BUILDINGS } from '@/data/buildings'
import { SECRET_SEATS } from './gongfaSeats'

/** 修满一个大境界要多久:走真实 store 的 cultPerSec,不另算公式 */
function realSecondsForMajor(major: number, kind: 'bare' | 'max'): number {
  setActivePinia(createPinia())
  const player = usePlayerStore()
  const cul = useCultivationStore()
  const dongfu = useDongfuStore()
  const res = useResourcesStore()

  if (kind === 'max') {
    // 典型灵根 1.6(非顶配)+ 该境最优功法 + 辅修栏占满 + 建筑满级 + 灵脉主脉吃满
    player.linggen = { roots: [{ element: 'wood', aptitude: 96 }], gradeName: '单灵根', growthMult: 1.6 }
    // 先定辅修槽位预算再选功法:超槽功法不生效(与 gongfaMods 的真实截断一致)
    for (const b of BUILDINGS) dongfu.setLevel(b.id, b.maxLevel)
    dongfu.veinPoints = { gather: 70, craft: 0, alchemy: 0, insight: 0 }
    dongfu.veinMain = 'gather'
    const subCap = dongfu.subGongfaSlots
    const usable = GONGFA.filter(g => g.minRealm <= major)
    const cultOf = (id: string): number => {
      const def = GONGFA.find(g => g.id === id)!
      const base = (def.baseMods.cultivationSpeed ?? 0) + (def.perLevelMods.cultivationSpeed ?? 0) * (def.maxLevel - 1)
      const branches = GONGFA_BRANCHES.filter(b => b.gongfaId === id).map(b => b.mods.cultivationSpeed ?? 0)
      return base + Math.max(0, ...branches)
    }
    const mains = usable.filter(g => g.type === 'main').sort((a, b) => cultOf(b.id) - cultOf(a.id))
    const subs = usable.filter(g => g.type !== 'main').sort((a, b) => cultOf(b.id) - cultOf(a.id))
    const mainId = mains[0]!.id
    // 席面各算各的账:辅修占满藏经阁预算,秘术另有一席(见 core/gongfaSeats)
    const subIds = [
      ...subs.filter(g => g.type === 'sub').slice(0, subCap),
      ...subs.filter(g => g.type === 'secret').slice(0, SECRET_SEATS)
    ].map(g => g.id)
    for (const id of [mainId, ...subIds]) {
      const def = GONGFA.find(g => g.id === id)!
      cul.learn(id)
      while ((cul.learned[id] ?? 0) < def.maxLevel) cul.upgrade(id)
      const branch = GONGFA_BRANCHES.filter(b => b.gongfaId === id).sort(
        (a, b) => (b.mods.cultivationSpeed ?? 0) - (a.mods.cultivationSpeed ?? 0)
      )[0]
      if (branch) cul.chooseBranch(id, branch.id)
    }
    cul.equipMain(mainId)
    for (const id of subIds) cul.toggleSub(id, subCap)
  } else {
    // 裸档:无 kit、无灵根加成
    player.linggen = { roots: [{ element: 'wood', aptitude: 60 }], gradeName: '单灵根', growthMult: 1 }
  }

  player.major = major
  let total = 0
  for (let s = 0; s < SUB_LEVELS; s++) {
    player.sub = s
    res.qi = player.qiCapValue // 灵气充盈(两档都算)
    total += toNum(expRequirement(major, s)) / player.cultPerSec
  }
  return total
}

describe('真实档节奏对账 · 模型必须落在裸档与满配之间', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('界外每一境:满配不慢于模型,裸档明显慢于模型', () => {
    console.log('\n界\t模型(天)\t满配(天)\t裸档(天)\t满/模型\t裸/模型')
    const failures: string[] = []
    for (let m = WORLD_BREAK_MAJOR; m <= MAX_MAJOR; m++) {
      const model = secondsForMajor(m, 0)
      const max = realSecondsForMajor(m, 'max')
      const bare = realSecondsForMajor(m, 'bare')
      console.log(
        `${m}\t${(model / 86400).toFixed(0)}\t${(max / 86400).toFixed(0)}\t${(bare / 86400).toFixed(0)}` +
          `\t${(max / model).toFixed(2)}\t${(bare / model).toFixed(2)}`
      )
      if (max > model * 1.02) failures.push(`境界 ${m}:满配真实档比模型还慢(${(max / model).toFixed(2)}×)`)
      // 留 1.5× 余量(天气与命格带来的浮动远小于它)
      if (bare < model * 1.5) failures.push(`境界 ${m}:裸档只比模型慢 ${(bare / model).toFixed(2)}× —— 模型过于悲观`)
      if (max >= bare) failures.push(`境界 ${m}:满配档不比裸档快 —— 这条对账量错了东西`)
    }
    expect(failures, failures.join('\n')).toEqual([])
  })
})
