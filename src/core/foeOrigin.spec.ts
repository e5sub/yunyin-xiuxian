/**
 * 敌人加成归因
 * 乘区:凡界 层级补偿 × 危地(出行方式 × 地界凶险 × 灵兽之性 × 区域事件);天界 道之理解、境界压制。
 *   ① 生成方(凡界 makeEnemySnap / 天界 worldFoeSnap)写明来源,账目与实数相符;
 *   ② 战报带走来源(resolveCombat → CombatResult.foeOrigin);
 *   ③ 战后分析有加成必报,中性判定不占字数。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { CombatSideStats, EnemyDef, FoeOrigin, RegionDef, WorldFoeShape } from '@/types'
import { gn, gnZero, ratio } from '@/utils/gnum'
import { COMBAT_ATK_BASE } from '@/data/constants'
import { enemyGearFactor, powerScale } from './formulas'
import { makeEnemySnap, mortalFoeOrigin, mortalFoeOriginFromParts, resolveCombat } from './combat'
import { dangerFactorFor, explorationFoeDanger, regionFoeOrigin } from './exploration'
import {
  celestialAnchor,
  celestialFoeOrigin,
  celestialJudgement,
  worldFoeSnap
} from './gauntlet'
import { analyzeBattle, battleDataRows, foeOriginLines, foeOriginRow } from './battleAnalysis'
import { RandomService, mulberry32 } from '@/utils/random'
import { EXPLORE_MODES } from '@/data/constants'
import { MAX_MAJOR } from '@/data/realms'
import { personalityEffects } from './petPersonality'

const DEF: EnemyDef = {
  id: 'test_foe',
  name: '试招石人',
  family: 'beast',
  tier: 6,
  hpMult: 1,
  atkMult: 1,
  defMult: 1,
  speed: 1,
  skills: []
}

const SHAPE: WorldFoeShape = {
  name: '试炼傀影',
  icon: 'x',
  atkR: 1,
  defR: 1,
  hpR: 1,
  speed: 1,
  mods: {},
  skills: []
}

const REGION: RegionDef = {
  id: 'test_region',
  name: '试炼场',
  desc: '',
  icon: 'x',
  tier: 8,
  danger: 5,
  minRealm: 3
} as RegionDef

function stats(partial: Partial<CombatSideStats> = {}): CombatSideStats {
  return {
    dealt: gn(1000),
    taken: gn(2000),
    pierceTaken: gnZero(),
    biggestHitTaken: gn(100),
    healed: gnZero(),
    shieldAbsorbed: gnZero(),
    dodges: 0,
    missedHits: 0,
    hitsLanded: 20,
    counters: 0,
    combos: 0,
    crits: 2,
    skillCasts: 3,
    artifactProcs: 1,
    stunnedTurns: 0,
    ...partial
  }
}

describe('凡界:敌人的加成来源必修写明', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('账目与实数相符 —— 从快照反推的倍率必须等于报价', () => {
    const danger = 1.45 * 0.95 * 1.15
    const snap = makeEnemySnap(DEF, 12, danger)
    // 真实倍率 = 敌攻 / (层级曲线 × 三围基数 × 模板系数)
    const realRatio = ratio(snap.attack, { m: powerScale(12).m * COMBAT_ATK_BASE * DEF.atkMult, e: powerScale(12).e })
    expect(snap.origin, '凡界敌人必须带加成来源').toBeDefined()
    expect(snap.origin!.ratio).toBeCloseTo(realRatio, 6)
    expect(snap.origin!.ratio).toBeCloseTo(enemyGearFactor(12) * danger, 6)
  })

  it('逐项摊开:层级补偿在前,危地其后;总数由各项相乘得出', () => {
    const o = mortalFoeOriginFromParts(12, [
      { label: '涉险求机', ratio: 2.1 },
      { label: '妖潮', ratio: 1.15 }
    ])
    expect(o.parts.map(p => p.label)).toEqual(['层级补偿', '涉险求机', '妖潮'])
    expect(o.ratio).toBeCloseTo(o.parts.reduce((a, p) => a * p.ratio, 1), 9)
  })

  it('历练那一场:四项来源摊开,总数与 dangerFactorFor 逐位相等', () => {
    const PET = 'p_qingniao'
    for (const mode of ['normal', 'deep', 'risky'] as const) {
      const cases = [
        { regionDanger: 1, petId: null, eventId: null },
        { regionDanger: 5, petId: PET, eventId: 'yaochao' as const }
      ]
      for (const c of cases) {
        const { total, origin } = explorationFoeDanger({ tier: 8, mode, ...c })
        const modeMult = EXPLORE_MODES[mode].dangerMult
        const petMult = c.petId ? personalityEffects(c.petId).dangerMult : 1
        const expected = dangerFactorFor(modeMult, c.regionDanger, petMult, c.eventId ? 1.15 : 1)
        // 唯一口径(在线/离线同一实现),摊开后总数须与之相等
        expect(total).toBeCloseTo(expected, 9)
        expect(origin.ratio).toBeCloseTo(enemyGearFactor(8) * expected, 9)
        expect(origin.parts[0]!.label, '层级补偿永远排在第一项').toBe('层级补偿')
      }
    }
  })

  it('选了涉险就是选了更凶的敌人 —— 同一处境下,档位越高账目越高', () => {
    const at = (mode: 'normal' | 'deep' | 'risky'): number =>
      explorationFoeDanger({ tier: 8, mode, regionDanger: 3, petId: null, eventId: null }).origin.ratio
    expect(at('deep')).toBeGreaterThan(at('normal'))
    expect(at('risky')).toBeGreaterThan(at('deep'))
  })

  it('选地卡片只报与出行方式无关的那一半(层级补偿 + 地界凶险)', () => {
    const o = regionFoeOrigin(REGION)
    expect(o.parts.map(p => p.label)).toEqual(['层级补偿', '地界凶险'])
    expect(o.ratio).toBeCloseTo(enemyGearFactor(REGION.tier) * (1 + (REGION.danger - 1) * 0.05), 9)
  })

  it('反向的账也要照实说:一阶敌人比这条线薄,就不许写成「加成」', () => {
    // 一阶层级补偿 ×0.90,低于 1 也要报
    const under = mortalFoeOrigin(1, 1)
    expect(under.ratio).toBeCloseTo(enemyGearFactor(1), 9)
    expect(under.ratio).toBeLessThan(1)
    expect(under.note).toContain('弱于本层')
  })
})

/** 中性(ratio===1):无额外加成,即天界「无判定」 */
const NEUTRAL: FoeOrigin = {
  label: '无判定',
  ratio: 1,
  damageBonus: 0,
  damageReduction: 0,
  parts: [],
  note: '无额外判定'
}

describe('天界:判定同样要报账', () => {
  const ref = celestialAnchor(22)

  it('加厚的账目与判定逐位一致,来源名写进 parts', () => {
    const heavy = { damageBonus: 3, damageReduction: 3, critRate: 3, lifesteal: 2, comboRate: 2 }
    const j = celestialJudgement(heavy, MAX_MAJOR, 22)
    const snap = worldFoeSnap(SHAPE, ref, 1, j)
    expect(snap.origin!.ratio).toBeCloseTo(j.thicken, 9)
    expect(snap.origin!.damageBonus).toBeCloseTo(j.damageBonus, 9)
    expect(snap.origin!.damageReduction).toBeCloseTo(j.damageReduction, 9)
    expect(snap.origin!.parts.map(p => p.label)).toContain('道之理解')
  })

  it('境界未及锚点:压制也要算进账目,并与道之理解分开写', () => {
    const j = celestialJudgement({}, 0, 22)
    expect(j.suppressed).toBe(true)
    const o = celestialFoeOrigin(j)
    expect(o.label).toContain('境界压制')
    expect(o.damageBonus).toBeGreaterThan(0)
  })

  it('连战加码(escalation)也写进来源,不然「第三场怎么突然更凶」又是谜', () => {
    const j = celestialJudgement({}, MAX_MAJOR, 22)
    const one = worldFoeSnap(SHAPE, ref, 1, j)
    const three = worldFoeSnap(SHAPE, ref, 1.06 * 1.06, j)
    expect(three.origin!.parts.map(p => p.label)).toContain('连战加码')
    expect(three.origin!.ratio).toBeCloseTo(j.thicken * 1.06 * 1.06, 9)
    expect(one.origin!.parts.map(p => p.label)).not.toContain('连战加码')
  })

  it('中性判定照实说「无额外判定」;有判定时只报账,不附方向语', () => {
    const j = celestialJudgement({}, MAX_MAJOR, 22)
    const o = celestialFoeOrigin(j)
    expect(o.ratio).toBe(1)
    expect(o.parts).toEqual([])
    expect(o.note).toBe('无额外判定')
    // 有判定时 note 留空:账目已在 parts 与增伤减伤里
    const heavy = celestialJudgement({ damageBonus: 3, critRate: 3 }, MAX_MAJOR, 22)
    expect(celestialFoeOrigin(heavy).note).toBe('')
  })
})

describe('战报把来源带走,分析照着讲', () => {
  const snap = (o?: ReturnType<typeof mortalFoeOrigin>) =>
    o ? makeEnemySnap(DEF, 12, 2, o) : makeEnemySnap(DEF, 12, 2)

  function player() {
    return {
      name: '你',
      icon: 'x',
      isPlayer: true,
      attack: gn(1e6),
      defense: gn(1e5),
      maxHp: gn(1e7),
      speed: 1.2,
      mods: {},
      skills: [{ name: '一记攻势', mult: 1, rate: 1 }]
    }
  }

  it('resolveCombat 把快照上的来源原样带进结果', () => {
    const enemy = snap()
    const r = resolveCombat(player(), enemy, new RandomService(mulberry32(3)))
    expect(r.foeOrigin).toBeDefined()
    expect(r.foeOrigin).toEqual(enemy.origin)
  })

  it('败北时,敌人的加成必须被点名', () => {
    const r = {
      win: false,
      rounds: 20,
      playerHpPct: 0,
      log: [],
      stats: { player: stats(), enemy: stats() },
      foeOrigin: snap().origin
    }
    const a = analyzeBattle(r, null)!
    const hit = a.findings.find(f => f.text.includes('敌之加成'))
    expect(hit, '敌人有额外加成却不报,玩家只能猜').toBeDefined()
    expect(hit!.text).toContain('层级补偿')
    // 不附劝导语
    expect(hit!.text).not.toContain('换更浅的出行方式')
  })

  it('数据行胜败都有:加成是个数,不是情绪', () => {
    const enemy = snap()
    for (const win of [true, false]) {
      const rows = battleDataRows({
        win,
        rounds: 10,
        playerHpPct: win ? 0.5 : 0,
        log: [],
        stats: { player: stats(), enemy: stats() },
        foeOrigin: enemy.origin
      })
      const row = rows.find(r => r.label === '敌之加成')
      expect(row, '战报里应当有一行敌之加成').toBeDefined()
      expect(row!.value).toContain('层级补偿')
      expect(row!.value).toContain('×')
    }
  })

  it('中性判定不占字数:没有加成就不给告警,读数写「无」', () => {
    const r = {
      win: false,
      rounds: 10,
      playerHpPct: 0,
      log: [],
      stats: { player: stats({ healed: gn(600) }), enemy: stats() },
      foeOrigin: NEUTRAL
    }
    const a = analyzeBattle(r, null)!
    expect(a.findings.some(f => f.text.includes('敌之加成'))).toBe(false)
    expect(foeOriginLines(r.foeOrigin)).toEqual([])
    expect(foeOriginRow(r.foeOrigin).value).toBe('无')
  })

  it('旧战报(没有 foeOrigin)照常工作 —— 不许因为缺一栏就崩', () => {
    const rows = battleDataRows({ win: true, rounds: 5, playerHpPct: 0.9, log: [], stats: { player: stats(), enemy: stats() } })
    expect(rows.some(r => r.label === '敌之加成')).toBe(false)
    expect(analyzeBattle({ win: false, rounds: 5, playerHpPct: 0, log: [], stats: { player: stats(), enemy: stats() } }, null)).not.toBeNull()
  })
})

/** 接线:读源码判定界面读了来源;界面改名、换读法会红 */
describe('来源到屏幕的接线', () => {
  const src = (p: string): string => readFileSync(resolve(__dirname, p), 'utf8')

  it('历练战报读同一份归因(逐项摊开的那一份)', () => {
    const intel = src('../components/adventure/BattleIntelPanel.vue')
    expect(intel, '战斗分析面板该照 analyzeBattle 讲').toContain('analyzeBattle(')
    const panel = src('../components/adventure/CombatPanel.vue')
    expect(panel, '宿主只挂载情报面板,不许再自己算分析').not.toContain('analyzeBattle(')
    const card = src('../components/adventure/RegionCard.vue')
    expect(card, '卡片该摊开已算好的来源').toContain('foeOrigin')
    expect(card, '卡片与战报共用同一个格式化').toContain('foeOriginPartsText(')
    const rows = src('../composables/useRegionRows.ts')
    expect(rows, '区域投影该读同一份归因').toContain('regionFoeOrigin(')
    const dialog = src('../components/adventure/ExploreModeDialog.vue')
    expect(dialog, '出行弹窗的遇险必须用与开战同一份 explorationFoeDanger').toContain('explorationFoeDanger')
    expect(dialog, '遇险数字要出现在出发按钮上').toContain('departButtonText')
  })

  it('天界战报(试炼/变数/忆战/重写/挑战)也读它,不再只有远征能说清判定', () => {
    const view = src('../views/CelestialView.vue')
    expect(view, '战报该从敌人快照上的来源取判定文案').toContain('foeOriginLines(')
  })

  it('凡界与天界的来源说明形状一致 —— 战后分析才能一份代码讲两边', () => {
    const combat = src('./combat.ts')
    const gauntlet = src('./gauntlet.ts')
    expect(combat, '凡界造敌必须写明来源').toMatch(/origin: origin \?\? mortalFoeOrigin/)
    expect(gauntlet, '天界造敌同样要写').toContain('celestialFoeOrigin(')
  })
})
