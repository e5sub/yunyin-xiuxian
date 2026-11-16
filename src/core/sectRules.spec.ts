/** 门派规则:价目曲线、山门闸门、捐献拆分、计时结算与状态修形 */
import { describe, expect, it } from 'vitest'
import {
  SECTS,
  SECT_BUILDINGS,
  SECT_DONATIONS,
  SECT_POOL_SHARE,
  SECT_SKILL_COST_BASE,
  SECT_SKILL_MAX_LEVEL,
  sectBuildingDef
} from '@/data/sect'
import {
  buildingCost,
  buildingDurationMs,
  buildingLevelCap,
  donationDef,
  donationQuota,
  donationSplit,
  memberCap,
  emptySectState,
  normalizeSectState,
  sectMods,
  sectNameOk,
  settleBuild,
  skillCost,
  skillUnlockNeed,
  type SectState
} from './sectRules'

const sect = SECTS[0]!
const skill1 = sect.skills[0]!
const skill5 = sect.skills[4]!

describe('门派数据', () => {
  it('三门宗门各有五层技能,层次 1~5 不重不漏', () => {
    for (const s of SECTS) {
      expect(s.skills).toHaveLength(5)
      expect(s.skills.map(k => k.row)).toEqual([1, 2, 3, 4, 5])
    }
  })

  it('技能 id 全站唯一(台账按 id 记等级,重号会串宗门)', () => {
    const ids = SECTS.flatMap(s => s.skills.map(k => k.id))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('五座建筑,山门是唯一闸门;贡献与耗时基数都为正', () => {
    expect(SECT_BUILDINGS).toHaveLength(5)
    expect(SECT_BUILDINGS.filter(b => b.id === 'hall')).toHaveLength(1)
    for (const b of SECT_BUILDINGS) {
      expect(b.costBase).toBeGreaterThan(0)
      expect(b.timeBaseMin).toBeGreaterThan(0)
      expect(b.maxLevel).toBeGreaterThan(0)
    }
  })

  it('捐献三档,份数与贡献都为正', () => {
    expect(SECT_DONATIONS).toHaveLength(3)
    for (const d of SECT_DONATIONS) {
      expect(d.amount).toBeGreaterThan(0)
      expect(d.contribution).toBeGreaterThan(0)
      expect(donationDef(d.kind)).toBe(d)
    }
    expect(donationDef('nope')).toBeUndefined()
  })
})

describe('技能价目', () => {
  it('逐级递增,满级返回 null', () => {
    const costs: number[] = []
    for (let lv = 0; lv < SECT_SKILL_MAX_LEVEL; lv += 1) {
      const c = skillCost(skill1.id, lv)
      expect(c).not.toBeNull()
      costs.push(c!)
    }
    expect(costs).toEqual([...costs].sort((a, b) => a - b))
    expect(costs[0]).toBe(SECT_SKILL_COST_BASE[0])
    expect(skillCost(skill1.id, SECT_SKILL_MAX_LEVEL)).toBeNull()
    expect(skillCost('nope', 0)).toBeNull()
  })

  it('层次越高越贵:同等级下第五层的价高于第一层', () => {
    expect(skillCost(skill5.id, 0)!).toBeGreaterThan(skillCost(skill1.id, 0)!)
  })

  it('解锁:第一层无条件,其后每层要上一层到 2 级', () => {
    expect(skillUnlockNeed(skill1.id)).toBeNull()
    for (let i = 1; i < 5; i += 1) {
      const need = skillUnlockNeed(sect.skills[i]!.id)
      expect(need).toEqual({ id: sect.skills[i - 1]!.id, level: 2 })
    }
    expect(skillUnlockNeed('nope')).toBeNull()
  })
})

describe('建筑价目与工期', () => {
  it('等级越高,贡献与耗时都越高(逐级严格递增)', () => {
    for (const b of SECT_BUILDINGS) {
      for (let lv = 0; lv < b.maxLevel - 1; lv += 1) {
        expect(buildingCost(b.id, lv + 1)!).toBeGreaterThan(buildingCost(b.id, lv)!)
        expect(buildingDurationMs(b.id, lv + 1)!).toBeGreaterThan(buildingDurationMs(b.id, lv)!)
      }
      expect(buildingCost(b.id, b.maxLevel)).toBeNull()
      expect(buildingDurationMs(b.id, b.maxLevel)).toBeNull()
    }
  })

  it('一级工期就是基数,十级要按小时算', () => {
    const hall = sectBuildingDef('hall')!
    expect(buildingDurationMs('hall', 0)).toBe(hall.timeBaseMin * 60_000)
    // 十级的演武场:五档基数 × 10^1.45 ≈ 两小时以上(不是几十秒的玩具)
    expect(buildingDurationMs('arena', 9)!).toBeGreaterThan(2 * 3_600_000)
    expect(buildingCost('arena', 9)!).toBeGreaterThan(buildingCost('arena', 0)! * 10)
  })

  it('山门闸门:其余建筑上限 = (山门+1)×2,并受自身满级所限', () => {
    expect(buildingLevelCap('hall', 0)).toBe(8)
    expect(buildingLevelCap('arena', 0)).toBe(2)
    expect(buildingLevelCap('arena', 1)).toBe(4)
    expect(buildingLevelCap('arena', 4)).toBe(10)
    // 山门再高也不会越过自身满级
    expect(buildingLevelCap('arena', 8)).toBe(10)
    expect(buildingLevelCap('nope', 8)).toBe(0)
  })
})

describe('捐献拆分', () => {
  it('三成入门派库,余数归个人,两份之和等于总额', () => {
    for (const d of SECT_DONATIONS) {
      const split = donationSplit(d.contribution)
      expect(split.pool + split.personal).toBe(d.contribution)
      expect(split.pool).toBe(Math.floor(d.contribution * SECT_POOL_SHARE))
      expect(split.personal).toBeGreaterThan(split.pool)
    }
    // 除不尽的档位也不丢一分
    expect(donationSplit(10)).toEqual({ personal: 7, pool: 3 })
    expect(donationSplit(-5)).toEqual({ personal: 0, pool: 0 })
  })
})

describe('门派属性', () => {
  it('无宗门、无等级 → 无加成', () => {
    expect(sectMods(null, {}, {})).toEqual({})
    expect(sectMods(sect.id, {}, {})).toEqual({})
  })

  it('技能与建筑各自按等级累加', () => {
    const mods = sectMods(sect.id, { [skill1.id]: 3 }, { arena: 5 })
    expect(mods.attackPct).toBeCloseTo(3 * 0.02 + 5 * 0.012, 6)
  })

  it('别的宗门的技能不计入(技能须属于本宗)', () => {
    const other = SECTS[1]!.skills[0]!
    expect(sectMods(sect.id, { [other.id]: 5 }, {})).toEqual({})
  })

  it('等级越界按上限计,不会凭坏数翻倍', () => {
    const mods = sectMods(sect.id, { [skill1.id]: 999 }, { hall: 999 })
    expect(mods.attackPct).toBeCloseTo(SECT_SKILL_MAX_LEVEL * 0.02, 6)
    expect(mods.cultivationSpeed).toBeCloseTo(8 * 0.015, 6)
  })
})

describe('计时结算', () => {
  const base = (over: Partial<SectState> = {}): SectState => ({ ...emptySectState(), ...over })

  it('未到点不完工,到点即落级并清空任务', () => {
    const state = base({ build: { id: 'arena', to: 1, startAt: 1_000, finishAt: 61_000 } })
    expect(settleBuild(state, 60_999).done).toBeNull()
    const after = settleBuild(state, 61_000)
    expect(after.done).toBe('arena')
    expect(after.state.buildings.arena).toBe(1)
    expect(after.state.build).toBeNull()
    // 不改入参
    expect(state.buildings.arena).toBeUndefined()
  })

  it('目标等级被写到上限之外:只清任务,不白送等级', () => {
    const state = base({ build: { id: 'arena', to: 99, startAt: 1_000, finishAt: 2_000 } })
    const after = settleBuild(state, 3_000)
    expect(after.state.build).toBeNull()
    // 山门 0 级时演武场只能到 2 级
    expect(after.state.buildings.arena).toBe(2)
  })
})

describe('状态修形', () => {
  const now = 1_700_000_000_000

  it('坏宗门与跨宗门技能被丢掉,合法技能留下', () => {
    const s = normalizeSectState(
      { sectId: 'taixu', skills: { taixu_sword: 3, danxia_fire: 4, taixu_break: 99 } },
      now
    )
    expect(s.sectId).toBe('taixu')
    expect(s.skills).toEqual({ taixu_sword: 3, taixu_break: 5 })
  })

  it('贡献取整并夹到上限,负数归零', () => {
    const s = normalizeSectState({ personal: -3, pool: 1e12, totalDonated: 12.9 }, now)
    expect(s.personal).toBe(0)
    expect(s.pool).toBe(1e9)
    expect(s.totalDonated).toBe(12)
  })

  it('建筑等级按山门闸门压回', () => {
    const s = normalizeSectState({ sectId: 'taixu', buildings: { hall: 0, arena: 9 } }, now)
    expect(s.buildings.arena).toBe(2)
  })

  it('工期被写短的营造任务直接作废(不修正成可完工)', () => {
    const def = sectBuildingDef('arena')!
    const full = buildingDurationMs('arena', 0)!
    // 合法:起点在过去,完工时刻 = 起点 + 合法工期
    const ok = normalizeSectState(
      { sectId: 'taixu', build: { id: 'arena', to: 1, startAt: now - 1000, finishAt: now - 1000 + full } },
      now
    )
    expect(ok.build).not.toBeNull()
    // 坏:工期只有一毫秒
    const bad = normalizeSectState(
      { sectId: 'taixu', build: { id: 'arena', to: 1, startAt: now - 1000, finishAt: now - 999 } },
      now
    )
    expect(bad.build).toBeNull()
    expect(def.id).toBe('arena')
  })

  it('目标不是「下一级」的任务作废', () => {
    const s = normalizeSectState(
      { sectId: 'taixu', build: { id: 'arena', to: 5, startAt: now - 1, finishAt: now + 60_000 } },
      now
    )
    expect(s.build).toBeNull()
  })

  it('初始状态全零且可枚举', () => {
    const s = emptySectState()
    expect(s).toMatchObject({ sectId: null, personal: 0, pool: 0, build: null, donationsToday: 0 })
    expect(s.skills).toEqual({})
    expect(s.buildings).toEqual({})
  })
})

describe('门派名', () => {
  it('二字至七字可用,首尾空白不收', () => {
    expect(sectNameOk('太虚剑宗')).toBe(true)
    expect(sectNameOk('青冥')).toBe(true)
    expect(sectNameOk('青云剑宗分号一号')).toBe(false) // 八字
    expect(sectNameOk('门')).toBe(false) // 一字
    expect(sectNameOk(' 青冥 ')).toBe(false)
    expect(sectNameOk(123)).toBe(false)
    expect(sectNameOk('青\n冥')).toBe(false)
  })

  it('修形:坏名置空,好名保留', () => {
    expect(normalizeSectState({ sectId: 'taixu', name: '青冥' }).name).toBe('青冥')
    expect(normalizeSectState({ sectId: 'taixu', name: 'x' }).name).toBe('')
  })
})

describe('每日次数与门人', () => {
  it('捐献次数:常驻三次,VIP 五次', () => {
    expect(donationQuota()).toBe(3)
    expect(donationQuota(true)).toBe(5)
    expect(donationQuota(false)).toBe(3)
  })

  it('门人上限:初始十人,山门每升一级 +1', () => {
    expect(memberCap(0)).toBe(10)
    expect(memberCap(1)).toBe(11)
    expect(memberCap(8)).toBe(18)
    // 坏数按零级算,不会把人数撑爆
    expect(memberCap(999)).toBe(18)
    expect(memberCap(-3)).toBe(10)
  })
})
