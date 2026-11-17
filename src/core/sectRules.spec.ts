/** 门派规则:价目曲线、山门闸门、捐献拆分、计时结算、成员名额与状态修形 */
import { describe, expect, it } from 'vitest'
import {
  SECTS,
  SECT_BUILDINGS,
  SECT_DONATIONS,
  SECT_LEVEL_HARD_MAX,
  SECT_POOL_SHARE,
  SECT_SKILLS,
  SECT_SKILL_COST_BASE,
  SECT_SKILL_MAX_LEVEL,
  sectBuildingDef,
  sectOfSkill
} from '@/data/sect'
import {
  applyCap,
  buildingCost,
  buildingDurationMs,
  buildingLevelCap,
  canJoin,
  canKickSect,
  canReviewSect,
  donationDef,
  donationQuota,
  donationSplit,
  emptySectState,
  hallSkillRate,
  hallTimeRate,
  memberCap,
  normalizeSectState,
  roleCap,
  sectMods,
  sectNameOk,
  settleBuild,
  skillCapNextHall,
  skillCost,
  skillLevelCap,
  skillPrevRow,
  skillUnlocked,
  type SectState
} from './sectRules'

const sect = SECTS[0]!
const skill1 = sect.skills[0]!
const skill5 = sect.skills[4]!

describe('门派数据', () => {
  it('三脉各有五层技能,层次 1~5 不重不漏', () => {
    expect(SECTS).toHaveLength(3)
    for (const s of SECTS) {
      expect(s.skills).toHaveLength(5)
      expect(s.skills.map(k => k.row)).toEqual([1, 2, 3, 4, 5])
    }
  })

  it('三脉合成一棵树:十五门,每层三脉各一门,id 全站唯一', () => {
    expect(SECT_SKILLS).toHaveLength(15)
    const ids = SECT_SKILLS.map(k => k.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (let row = 1; row <= 5; row += 1) {
      expect(SECT_SKILLS.filter(k => k.row === row), `第 ${row} 层不是三门`).toHaveLength(3)
    }
    // 每门都认得出来自哪一脉(界面按它标小字)
    for (const k of SECT_SKILLS) expect(sectOfSkill(k.id)).toBeDefined()
    expect(sectOfSkill('nope')).toBeUndefined()
  })

  it('五座建筑,山门是唯一闸门;贡献与耗时基数都为正', () => {
    expect(SECT_BUILDINGS).toHaveLength(5)
    expect(SECT_BUILDINGS.filter(b => b.id === 'hall')).toHaveLength(1)
    for (const b of SECT_BUILDINGS) {
      expect(b.costBase).toBeGreaterThan(0)
      expect(b.timeBaseMin).toBeGreaterThan(0)
      // 门派建筑没有品类满级(1.69.0):数据里不该再有 maxLevel
      expect('maxLevel' in b).toBe(false)
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

  it('同层三选一:第一层无条件,其后每层要上一层任一门到二重', () => {
    for (const k of SECT_SKILLS.filter(s => s.row === 1)) expect(skillUnlocked({}, k.id)).toBe(true)
    expect(skillPrevRow(skill1.id)).toEqual([])

    for (const k of SECT_SKILLS.filter(s => s.row === 2)) {
      const prev = skillPrevRow(k.id)
      expect(prev).toHaveLength(3)
      expect(skillUnlocked({}, k.id)).toBe(false)
      // 上一层三脉,修哪一门都算入门
      for (const p of prev) {
        expect(skillUnlocked({ [p]: 2 }, k.id), `${k.id} 未吃到 ${p} 的二重`).toBe(true)
      }
      expect(skillUnlocked({ [prev[0]!]: 1 }, k.id)).toBe(false)
    }
  })
})

describe('建筑价目与工期', () => {
  it('没有满级:任何等级都有价目,且逐级严格递增', () => {
    for (const b of SECT_BUILDINGS) {
      for (const lv of [0, 1, 9, 19, 49, 99]) {
        expect(buildingCost(b.id, lv)!).toBeGreaterThan(0)
        expect(buildingCost(b.id, lv + 1)!).toBeGreaterThan(buildingCost(b.id, lv)!)
        expect(buildingDurationMs(b.id, lv + 1)!).toBeGreaterThan(buildingDurationMs(b.id, lv)!)
      }
    }
    expect(buildingCost('nope', 0)).toBeNull()
    expect(buildingDurationMs('nope', 0)).toBeNull()
  })

  it('工期只缓涨:一级几分钟,十级半小时上下,百级仍在半天之内', () => {
    const hall = sectBuildingDef('hall')!
    expect(buildingDurationMs('hall', 0)).toBe(hall.timeBaseMin * 60_000)
    // 十级的演武场:五档基数 × 10^0.75 ≈ 半小时(不是几十秒的玩具,也不是几小时的罚站)
    const ten = buildingDurationMs('arena', 9)! / 60_000
    expect(ten).toBeGreaterThan(20)
    expect(ten).toBeLessThan(60)
    // 一百级也不该把人锁在门外
    expect(buildingDurationMs('arena', 99)! / 3_600_000).toBeLessThan(6)
  })

  it('山门闸门:山门自身只受硬夹,其余 = (山门+1)×2 且不再有品类满级', () => {
    expect(buildingLevelCap('hall', 0)).toBe(SECT_LEVEL_HARD_MAX)
    expect(buildingLevelCap('arena', 0)).toBe(2)
    expect(buildingLevelCap('arena', 1)).toBe(4)
    expect(buildingLevelCap('arena', 4)).toBe(10)
    // 山门升到 8 级:演武场能到 18 级(旧版被自身满级卡在 10)
    expect(buildingLevelCap('arena', 8)).toBe(18)
    expect(buildingLevelCap('arena', 49)).toBe(100)
    expect(buildingLevelCap('nope', 8)).toBe(0)
  })
})

describe('山门照拂:技能减耗与工期缩短', () => {
  it('技能个人贡献:山门每级 -0.5%,百级封顶 -50%', () => {
    const full = skillCost(skill1.id, 0, 1, 0)!
    expect(hallSkillRate(0)).toBe(1)
    expect(skillCost(skill1.id, 0, 1, 20)! / full).toBeCloseTo(0.9, 6)
    expect(skillCost(skill1.id, 0, 1, 100)! / full).toBeCloseTo(0.5, 6)
    // 封顶之后不再降:百级与硬夹上限同价
    expect(skillCost(skill1.id, 0, 1, SECT_LEVEL_HARD_MAX)).toBe(skillCost(skill1.id, 0, 1, 100))
    expect(hallSkillRate(SECT_LEVEL_HARD_MAX)).toBe(0.5)
  })

  it('VIP 九折与山门减免相乘:两者都享时折上折,且逐重仍严格递增', () => {
    const full = skillCost(skill1.id, 0, 1, 0)!
    expect(skillCost(skill1.id, 0, 0.9, 100)! / full).toBeCloseTo(0.45, 6)
    let prev = 0
    for (let lv = 0; lv < 30; lv += 1) {
      const vip = skillCost(skill5.id, lv, 0.9, 100)!
      const plain = skillCost(skill5.id, lv, 1, 100)!
      /*
       * 九折实付 ≈ 牌价 × 0.9:两处各自向上取整,差最多 1 点贡献
       * (先合后乘再取整,不能拿已取整的牌价再乘 —— 那会多算一点)。
       * 要紧的是:VIP 一定更便宜,且不出现「折后比牌价还贵」的荒谬值。
       */
      expect(Math.abs(vip - plain * 0.9)).toBeLessThanOrEqual(1)
      expect(vip).toBeLessThanOrEqual(Math.ceil(plain * 0.9))
      expect(vip).toBeLessThan(plain)
      expect(vip).toBeGreaterThan(prev)
      prev = vip
    }
  })

  it('工期:山门每级 -1%,封顶只剩四成', () => {
    const base = buildingDurationMs('arena', 9)!
    expect(hallTimeRate(0)).toBe(1)
    expect(buildingDurationMs('arena', 9, 20)! / base).toBeCloseTo(0.8, 3)
    expect(buildingDurationMs('arena', 9, 100)! / base).toBeCloseTo(0.4, 3)
    expect(buildingDurationMs('arena', 9, SECT_LEVEL_HARD_MAX)).toBe(buildingDurationMs('arena', 9, 100))
  })

  it('减免不吃掉「愈高愈贵」:同一山门等级下,价与工期仍随等级涨', () => {
    for (const b of SECT_BUILDINGS) {
      expect(buildingCost(b.id, 30)!).toBeGreaterThan(buildingCost(b.id, 20)!)
      expect(buildingDurationMs(b.id, 30, 100)!).toBeGreaterThan(buildingDurationMs(b.id, 20, 100)!)
    }
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
  it('无等级 → 无加成', () => {
    expect(sectMods({}, {})).toEqual({})
  })

  it('技能与建筑各自按等级累加', () => {
    const mods = sectMods({ [skill1.id]: 3 }, { arena: 5 })
    expect(mods.attackPct).toBeCloseTo(3 * 0.02 + 5 * 0.012, 6)
  })

  it('三脉技能都算:不再按宗门过滤', () => {
    const other = SECTS[1]!.skills[0]!
    const mods = sectMods({ [other.id]: 5 }, {})
    expect(mods.alchemyYield).toBeCloseTo(5 * 0.04, 6)
  })

  it('等级越界按上限计,不会凭坏数翻倍', () => {
    const mods = sectMods({ [skill1.id]: 999 }, { hall: 4 })
    expect(mods.attackPct).toBeCloseTo(SECT_SKILL_MAX_LEVEL * 0.02, 6)
    expect(mods.cultivationSpeed).toBeCloseTo(4 * 0.015, 6)
  })
})

describe('技能上限随山门', () => {
  it('基础五重,山门 20/40/60/80/100 级各开五重,百级封顶三十重', () => {
    expect(skillLevelCap(0)).toBe(5)
    expect(skillLevelCap(19)).toBe(5)
    expect(skillLevelCap(20)).toBe(10)
    expect(skillLevelCap(39)).toBe(10)
    expect(skillLevelCap(40)).toBe(15)
    expect(skillLevelCap(60)).toBe(20)
    expect(skillLevelCap(80)).toBe(25)
    expect(skillLevelCap(100)).toBe(30)
    expect(skillLevelCap(999)).toBe(30)
    // 坏数不当真:负级按零级算,天文数字按百级算
    expect(skillLevelCap(-5)).toBe(5)
    expect(skillLevelCap(1e9)).toBe(30)
  })

  it('再开一重的山门等级;开尽之后回 null', () => {
    expect(skillCapNextHall(0)).toBe(20)
    expect(skillCapNextHall(19)).toBe(20)
    expect(skillCapNextHall(20)).toBe(40)
    expect(skillCapNextHall(99)).toBe(100)
    expect(skillCapNextHall(100)).toBeNull()
    expect(skillCapNextHall(999)).toBeNull()
  })

  it('山门未及那一档:下一重的价目是 null;到了就有价', () => {
    expect(skillCost(skill1.id, 9, 1, 20)).not.toBeNull()
    expect(skillCost(skill1.id, 10, 1, 20)).toBeNull()
    // 同一个等级,山门只到 19 级时还不能修
    expect(skillCost(skill1.id, 9, 1, 19)).toBeNull()
    // 不给山门即按基础五重算(旧调用点的语义不变)
    expect(skillCost(skill1.id, 5)).toBeNull()
  })

  it('等级越高越贵:五重之内每重约 ×1.9,续修每重 ×1.15,逐重严格递增', () => {
    let prev = 0
    for (let lv = 0; lv < 30; lv += 1) {
      const c = skillCost(skill5.id, lv, 1, 100)
      expect(c).not.toBeNull()
      expect(c!).toBeGreaterThan(prev)
      if (lv > 0) {
        const ratio = c! / prev
        // 前五重陡涨,五重之后转缓;两条斜率都必须是「越往上越贵」,不许出现平段
        if (lv <= 4) expect(ratio, `第 ${lv + 1} 重该按 ×1.9`).toBeGreaterThan(1.85)
        else expect(ratio, `第 ${lv + 1} 重该按 ×1.15`).toBeGreaterThan(1.14)
        expect(ratio).toBeLessThan(1.95)
      }
      prev = c!
    }
    // 第五层第三十重的单次价:六位数 —— 既不白送,也没贵到亿级
    expect(prev).toBeGreaterThan(1e5)
    expect(prev).toBeLessThan(1e6)
  })

  it('属性也按山门定的上限夹:同一份技能,山门 20 级才吃十重', () => {
    expect(sectMods({ [skill1.id]: 10 }, { hall: 0 }).attackPct).toBeCloseTo(5 * 0.02, 6)
    expect(sectMods({ [skill1.id]: 10 }, { hall: 20 }).attackPct).toBeCloseTo(10 * 0.02, 6)
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

  it('目标等级被写到闸门之外:只按闸门落级,不白送多余等级', () => {
    const state = base({ build: { id: 'arena', to: 99, startAt: 1_000, finishAt: 2_000 } })
    const after = settleBuild(state, 3_000)
    expect(after.state.build).toBeNull()
    // 山门 0 级时演武场只能到 2 级
    expect(after.state.buildings.arena).toBe(2)
  })

  it('山门自己不受闸门限制:写多高就落多高(只受硬夹)', () => {
    const state = base({ build: { id: 'hall', to: 30, startAt: 1_000, finishAt: 2_000 } })
    expect(settleBuild(state, 3_000).state.buildings.hall).toBe(30)
  })
})

describe('状态修形', () => {
  const now = 1_700_000_000_000
  /** 名字是「已立派」的唯一凭据 —— 修形用例都带一个合法名 */
  const founded = { name: '青冥剑宗' }

  it('名字不合法 → 整份按未立派处理(技能与建筑一并丢弃)', () => {
    const s = normalizeSectState({ name: 'x', skills: { taixu_sword: 3 }, buildings: { hall: 5 } }, now)
    expect(s.name).toBe('')
    expect(s.skills).toEqual({})
    expect(s.buildings).toEqual({})
    expect(s.role).toBeNull()
  })

  it('三脉技能都留,认不出的丢,越界夹到五重', () => {
    const s = normalizeSectState(
      { ...founded, skills: { taixu_sword: 3, danxia_fire: 4, taixu_break: 99, nope: 2 } },
      now
    )
    expect(s.skills).toEqual({ taixu_sword: 3, danxia_fire: 4, taixu_break: 5 })
  })

  it('贡献取整并夹到上限,负数归零', () => {
    const s = normalizeSectState({ ...founded, personal: -3, pool: 1e12, totalDonated: 12.9 }, now)
    expect(s.personal).toBe(0)
    expect(s.pool).toBe(1e9)
    expect(s.totalDonated).toBe(12)
  })

  it('建筑等级按山门闸门压回(山门自身只受硬夹)', () => {
    const s = normalizeSectState({ ...founded, buildings: { hall: 0, arena: 9 } }, now)
    expect(s.buildings.arena).toBe(2)
    const tall = normalizeSectState({ ...founded, buildings: { hall: 8, arena: 99 } }, now)
    expect(tall.buildings.arena).toBe(18)
    expect(tall.buildings.hall).toBe(8)
  })

  it('技能等级按山门档位压回:先落山门,再按它夹技能', () => {
    const low = normalizeSectState({ ...founded, buildings: { hall: 0 }, skills: { taixu_sword: 9 } }, now)
    expect(low.skills.taixu_sword).toBe(5)
    const mid = normalizeSectState({ ...founded, buildings: { hall: 20 }, skills: { taixu_sword: 9 } }, now)
    expect(mid.skills.taixu_sword).toBe(9)
    const over = normalizeSectState({ ...founded, buildings: { hall: 20 }, skills: { taixu_sword: 30 } }, now)
    expect(over.skills.taixu_sword).toBe(10)
    const top = normalizeSectState({ ...founded, buildings: { hall: 100 }, skills: { taixu_sword: 30 } }, now)
    expect(top.skills.taixu_sword).toBe(30)
  })

  it('工期被写短的营造任务直接作废(不修正成可完工)', () => {
    const full = buildingDurationMs('arena', 0)!
    // 合法:起点在过去,完工时刻 = 起点 + 合法工期
    const ok = normalizeSectState(
      { ...founded, build: { id: 'arena', to: 1, startAt: now - 1000, finishAt: now - 1000 + full } },
      now
    )
    expect(ok.build).not.toBeNull()
    // 坏:工期只有一毫秒
    const bad = normalizeSectState(
      { ...founded, build: { id: 'arena', to: 1, startAt: now - 1000, finishAt: now - 999 } },
      now
    )
    expect(bad.build).toBeNull()
  })

  it('目标不是「下一级」的任务作废', () => {
    const s = normalizeSectState({ ...founded, build: { id: 'arena', to: 5, startAt: now - 1, finishAt: now + 60_000 } }, now)
    expect(s.build).toBeNull()
  })

  it('身份与门人数只在已立派时成立', () => {
    expect(normalizeSectState({ ...founded, role: 'leader', memberCount: 3 }, now).role).toBe('leader')
    expect(normalizeSectState({ ...founded, role: 'leader' }, now).memberCount).toBe(0)
    // 认不出的身份当门人之外的「无」——界面按 null 处理
    expect(normalizeSectState({ ...founded, role: 'boss' }, now).role).toBeNull()
    expect(normalizeSectState({ name: '', role: 'leader', memberCount: 3 }, now).role).toBeNull()
  })

  it('初始状态全零且可枚举', () => {
    const s = emptySectState()
    expect(s).toMatchObject({ name: '', personal: 0, pool: 0, build: null, donationsToday: 0, role: null, memberCount: 0 })
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
    expect(normalizeSectState({ name: '青冥' }).name).toBe('青冥')
    expect(normalizeSectState({ name: 'x' }).name).toBe('')
  })
})

describe('每日次数、名额与投师门槛', () => {
  it('捐献次数:常驻三次,VIP 五次', () => {
    expect(donationQuota()).toBe(3)
    expect(donationQuota(true)).toBe(5)
    expect(donationQuota(false)).toBe(3)
  })

  it('门人上限:初始十人,山门每升一级 +1(山门不封顶,名额也不封顶)', () => {
    expect(memberCap(0)).toBe(10)
    expect(memberCap(1)).toBe(11)
    expect(memberCap(8)).toBe(18)
    expect(memberCap(30)).toBe(40)
    // 坏数按硬上界与零级算
    expect(memberCap(1e9)).toBe(10 + SECT_LEVEL_HARD_MAX)
    expect(memberCap(-3)).toBe(10)
  })

  it('投师门槛低于开派:筑基可投,元婴可开', () => {
    expect(canJoin(0)).toBe(false)
    expect(canJoin(1)).toBe(true)
    expect(canJoin(3)).toBe(true)
  })

  it('门外候着的申请有上限(挡刷申请)', () => {
    expect(applyCap()).toBeGreaterThan(0)
  })
})

describe('职位授权(1.71.0)', () => {
  it('名额表:副掌门一位、长老四位,掌门与门人不走名额', () => {
    expect(roleCap('deputy')).toBe(1)
    expect(roleCap('elder')).toBe(4)
    expect(roleCap('leader')).toBeNull()
    expect(roleCap('member')).toBeNull()
  })

  it('审批权:掌门/副掌门/长老可审,门人与未入门不可审', () => {
    expect(canReviewSect('leader')).toBe(true)
    expect(canReviewSect('deputy')).toBe(true)
    expect(canReviewSect('elder')).toBe(true)
    expect(canReviewSect('member')).toBe(false)
    expect(canReviewSect(null)).toBe(false)
  })

  it('逐人授权矩阵:掌门逐掌门以外的一切人;副掌门逐长老与门人;其余无权', () => {
    for (const target of ['deputy', 'elder', 'member'] as const) {
      expect(canKickSect('leader', target)).toBe(true)
    }
    expect(canKickSect('leader', 'leader')).toBe(false)
    expect(canKickSect('deputy', 'elder')).toBe(true)
    expect(canKickSect('deputy', 'member')).toBe(true)
    expect(canKickSect('deputy', 'leader')).toBe(false)
    expect(canKickSect('deputy', 'deputy')).toBe(false)
    expect(canKickSect('elder', 'member')).toBe(false)
    expect(canKickSect('member', 'member')).toBe(false)
  })

  it('修形认得四个身份:副掌门与长老原样留下,坏值落回空', () => {
    expect(normalizeSectState({ name: '青冥', role: 'deputy' }).role).toBe('deputy')
    expect(normalizeSectState({ name: '青冥', role: 'elder' }).role).toBe('elder')
    expect(normalizeSectState({ name: '青冥', role: 'grandmaster' }).role).toBeNull()
    expect(normalizeSectState({ name: '', role: 'leader' }).role).toBeNull()
  })
})
