/* eslint-disable no-console -- 打印逐境内容矩阵 */
/**
 * 内容密度审计:每个境界都得有新东西可学、可去、可打。
 * 判据:每境至少一条门槛恰好落在该境的功法(参悟池按 minRealm ≤ 当前+1 过滤,表里有即撞得见)。
 * 故障注入:把任一条功法的 minRealm 挪走(如 m_daluo 13 → 12),对应境界红;把地界全挪到别的境界,「地界」那条红。
 * 神界/混沌海的秘境为 0 是设计:秘境只做凡境(元婴·灵石)与天界(真仙·道源)两阶。
 */
import { describe, expect, it } from 'vitest'
import { MAX_MAJOR, REALMS, WORLDS, WORLD_BREAK_MAJOR, worldOf } from '@/data/realms'
import { REGIONS } from '@/data/regions'
import { ENEMIES } from '@/data/enemies'
import { GONGFA } from '@/data/gongfa'
import { PILLS } from '@/data/pills'
import { pillFamily, pillGainSecAt } from '@/core/pillValue'
import { EQUIPMENT_TEMPLATES } from '@/data/equipment'
import { ARTIFACTS, ARTIFACT_MAX_SLOTS } from '@/data/artifacts'
import { SECRET_REALMS } from '@/data/secretRealms'
import { CHAINS } from '@/data/chains'
import { EVENTS, eventDef } from '@/data/events'
import { PETS } from '@/data/pets'
import { WORLD_WEATHERS } from '@/core/weather'

/** 某境界的地界所占的层级 */
function tiersOf(major: number): Set<number> {
  return new Set(REGIONS.filter(r => r.minRealm === major).map(r => r.tier))
}

describe('内容密度 · 每一境都得有新东西', () => {
  it('逐境内容矩阵(读表,不手抄)', () => {
    const head = ['境界', '地界', '敌人', '新功法', '新丹方']
    console.log(head.join('\t'))
    for (let m = 0; m <= MAX_MAJOR; m++) {
      const regions = REGIONS.filter(r => r.minRealm === m)
      const tiers = tiersOf(m)
      console.log(
        [
          `${m} ${REALMS[m]!.name}`,
          regions.length,
          ENEMIES.filter(e => tiers.has(e.tier)).length,
          GONGFA.filter(g => g.minRealm === m).length,
          PILLS.filter(p => p.minRealm === m).length
        ].join('\t')
      )
    }
  })

  it('每一境都至少有一条门槛落在该境的功法 —— 境界不能只是数值台阶', () => {
    const empty: string[] = []
    for (let m = 0; m <= MAX_MAJOR; m++) {
      if (!GONGFA.some(g => g.minRealm === m)) empty.push(`${m} ${REALMS[m]!.name}`)
    }
    expect(empty, `这些境界没有任何新功法可参悟:${empty.join('、')}`).toEqual([])
  })

  it('每一境也都有自己的丹 —— 与「每境都有新功法」同一条理由', () => {
    const empty: string[] = []
    for (let m = 0; m <= MAX_MAJOR; m++) {
      if (!PILLS.some(p => p.minRealm === m)) empty.push(`${m} ${REALMS[m]!.name}`)
    }
    expect(empty, `这些境界没有任何本境丹药:${empty.join('、')}`).toEqual([])
  })

  /** 底线取人间界最小值而非中位数:人间界前段偏厚(炼气 22 条),尾巴(大乘/渡劫)也是 10 条 */
  it('新界每一境都不薄于人间界最薄的一境(逐境条数有底线)', () => {
    const totalOf = (m: number): number => {
      const regions = REGIONS.filter(r => r.minRealm === m)
      const tiers = new Set(regions.map(r => r.tier))
      return (
        regions.length +
        ENEMIES.filter(e => tiers.has(e.tier)).length +
        GONGFA.filter(g => g.minRealm === m).length +
        PILLS.filter(p => p.minRealm === m).length
      )
    }
    const mortal = Array.from({ length: WORLD_BREAK_MAJOR }, (_, m) => totalOf(m))
    const floor = Math.min(...mortal)
    const beyond = Array.from({ length: MAX_MAJOR - WORLD_BREAK_MAJOR + 1 }, (_, i) => totalOf(WORLD_BREAK_MAJOR + i))
    console.log(`\n逐境条数:人间界 min ${floor} / 中位 ${[...mortal].sort((a, b) => a - b)[Math.floor(mortal.length / 2)]}` +
      ` · 新界 min ${Math.min(...beyond)} / 中位 ${[...beyond].sort((a, b) => a - b)[Math.floor(beyond.length / 2)]}`)
    for (let i = 0; i < beyond.length; i++) {
      const m = WORLD_BREAK_MAJOR + i
      expect(beyond[i]!, `${REALMS[m]!.name} 只有 ${beyond[i]} 条内容,薄于人间界最薄的 ${floor} 条`).toBeGreaterThanOrEqual(floor)
    }
    expect(floor, '人间界本身没有一条底线,判据形同虚设').toBeGreaterThan(0)
  })

  it('丹方越晚越强:同族同线里,门槛更高的那一味药力不更低', () => {
    // 法则 B 只比品质高低,再按门槛比一遍
    const TIMED = ['exp', 'qi', 'lifespan', 'wudao', 'tempo'] as const
    for (const fam of TIMED) {
      for (const line of ['craft', 'drop'] as const) {
        const group = PILLS.filter(p => pillFamily(p) === fam && (p.recipe ? 'craft' : 'drop') === line).sort(
          (a, b) => a.minRealm - b.minRealm
        )
        for (let i = 1; i < group.length; i++) {
          const prev = group[i - 1]!
          const cur = group[i]!
          // 统一到两者的较高门槛折算,排除境界差
          const at = Math.max(prev.minRealm, cur.minRealm)
          expect(
            pillGainSecAt(cur, at),
            `${cur.name}(境${cur.minRealm})比更早的 ${prev.name}(境${prev.minRealm})还弱`
          ).toBeGreaterThanOrEqual(pillGainSecAt(prev, at) - 1e-9)
        }
      }
    }
  })

  it('每一境都有地界可去,且地界里有人可打', () => {
    for (let m = 0; m <= MAX_MAJOR; m++) {
      const regions = REGIONS.filter(r => r.minRealm === m)
      expect(regions.length, `${REALMS[m]!.name} 无地界可去`).toBeGreaterThanOrEqual(1)
      const tiers = tiersOf(m)
      expect(ENEMIES.filter(e => tiers.has(e.tier)).length, `${REALMS[m]!.name} 的地界里没有敌人`).toBeGreaterThanOrEqual(1)
    }
  })

  it('每一界域都有自己的天时(人间界固定池,其余按界域分池)', () => {
    for (const w of WORLDS) {
      const pool = w.id === 'mortal' ? 6 : (WORLD_WEATHERS[w.id as 'immortal' | 'god' | 'chaos']?.length ?? 0)
      expect(pool, `${w.name} 没有专属天时`).toBeGreaterThanOrEqual(1)
    }
  })

  it('各界域的内容条数(装备/法宝/秘境/天时)—— 秘境只有两阶是设计,不是漏做', () => {
    const tierWorld = new Map<number, string>()
    for (const r of REGIONS) tierWorld.set(r.tier, worldOf(r.minRealm).id)
    const rows = WORLDS.map(w => {
      const inWorld = <T,>(xs: T[], pick: (x: T) => number): number => xs.filter(x => tierWorld.get(pick(x)) === w.id).length
      return {
        world: w.name,
        装备模板: inWorld(EQUIPMENT_TEMPLATES, t => t.tier),
        法宝: inWorld(ARTIFACTS, a => a.fromTier),
       秘境: SECRET_REALMS.filter(s => (s.gate === 'celestial' ? 'immortal' : 'mortal') === w.id).length
      }
    })
    // 奇缘按起点所属界域记
    const chainStarts = WORLDS.map(w => CHAINS.filter(c => worldOf(eventDef(c.stages[0]!)?.minRealm ?? 0).id === w.id).length)
    console.log('界域\t装备模板\t法宝\t秘境(仅两阶)\t奇缘起点')
    rows.forEach((r, i) => console.log(`${r.world}\t${r.装备模板}\t${r.法宝}\t${r.秘境}\t${chainStarts[i]}`))
    for (const r of rows) {
      expect(r.装备模板, `${r.world} 没有专属装备模板`).toBeGreaterThan(0)
      expect(r.法宝, `${r.world} 没有专属法宝`).toBeGreaterThan(0)
    }
  })

  it('高界的法宝也成取舍:一个界域的法宝件数要多于可装备的槽位数', () => {
    const tierWorld = new Map<number, string>()
    for (const r of REGIONS) tierWorld.set(r.tier, worldOf(r.minRealm).id)
    for (const w of WORLDS) {
      const n = ARTIFACTS.filter(a => tierWorld.get(a.fromTier) === w.id).length
      expect(n, `${w.name} 有 ${n} 件法宝、${ARTIFACT_MAX_SLOTS} 个法宝位 —— 带满即最优,没有取舍`).toBeGreaterThan(
        ARTIFACT_MAX_SLOTS
      )
    }
  })

  /**
   * 灵兽没有 minRealm 字段,门槛写在发放事件里(事件的 minRealm 或界域标签),故从事件反推界域,不给灵兽表补字段。
   * 数种数不数事件条数:不定名发放(妖兽认主)抽「仙品以下还没结缘的灵兽」,一只就覆盖人间界那一池子;高界灵兽须点名给出。
   * 故障注入:把某一界的灵兽奖励改成别的奖励,对应界域红。
   */
  it('每个界域都结得到灵兽,且不止一只 —— 门槛写在发放事件里', () => {
    const WORLD_TAGS: Record<string, string> = { immortal: 'immortal', sky: 'immortal', god: 'god', chaos: 'chaos' }
    /** 界域 → 该界点名发放的灵兽 id */
    const namedByWorld = new Map<string, Set<string>>(WORLDS.map(w => [w.id, new Set<string>()]))
    const poolWorlds = new Set<string>()
    for (const ev of EVENTS) {
      const grantsPet = ev.choices.some(ch => ch.outcomes.some(o => o.effects.some(e => e.type === 'pet')))
      if (!grantsPet) continue
      const byRealm = ev.minRealm !== undefined ? worldOf(ev.minRealm).id : undefined
      const byTag = ev.tags.map(t => WORLD_TAGS[t]).find(Boolean)
      const world = byRealm ?? byTag ?? 'mortal'
      for (const ch of ev.choices) {
        for (const o of ch.outcomes) {
          for (const e of o.effects) {
            if (e.type !== 'pet') continue
            if (e.id) namedByWorld.get(world)!.add(e.id)
            else poolWorlds.add(world)
          }
        }
      }
    }
    /** 不定名那一池子 = 没被任何事件点过名的灵兽 */
    const named = new Set([...namedByWorld.values()].flatMap(s => [...s]))
    const poolSize = PETS.filter(p => !named.has(p.id)).length
    console.log(
      '界域\t点名灵兽\t随机池\n' +
        WORLDS.map(w => `${w.name}\t${namedByWorld.get(w.id)!.size}\t${poolWorlds.has(w.id) ? poolSize : 0}`).join('\n')
    )
    for (const w of WORLDS) {
      const available = namedByWorld.get(w.id)!.size + (poolWorlds.has(w.id) ? poolSize : 0)
      expect(available, `${w.name} 只有 ${available} 只灵兽可结缘 —— 灵兽位只有一个,一只就是唯一解`).toBeGreaterThan(1)
    }
  })
})
