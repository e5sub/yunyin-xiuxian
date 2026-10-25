/* eslint-disable no-console -- 三档的稀度对账表是给人看的 */
/**
 * 历练三档触发(际遇 / 机缘 / 奇缘)审计:
 * ① 每件能弹窗的事归且只归一档 ② 模型 = 引擎(公告的「约每 N 程」与真掷一致)
 * ③ 越罕见等得越久 ④ 界面读同一份口径
 * 引擎掷序:先奇缘闸门(须有该走的下一程)、再机缘、余下才是际遇。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createPinia, setActivePinia } from 'pinia'
import { EVENTS, FORTUNE_EVENTS } from '@/data/events'
import { CHAINS, CHAIN_EVENTS } from '@/data/chains'
import { EXPLORE_EVENT_CHANCE } from '@/data/constants'
import { EVENT_TIERS, eventTierDef, eventTierOf, tierChances, tierEncountersPerTrigger, tierOddsText } from './eventTier'
import { pickEventFor } from './eventEngine'
import { RandomService, mulberry32 } from '@/utils/random'
import { regionDef } from '@/data/regions'
import { usePlayerStore } from '@/stores/player'
import type { EventTier } from './eventTier'

const PILLARS: EventTier[] = ['jingyu', 'jiyuan', 'qiyuan']

describe('三档触发 · 分类', () => {
  it('每一件能弹窗的事都归得进某一档', () => {
    for (const ev of [...EVENTS, ...FORTUNE_EVENTS]) {
      expect(PILLARS).toContain(eventTierOf(ev.id))
    }
  })

  it('三档互斥:奇缘的事件不会被当成机缘,反之亦然', () => {
    for (const ev of CHAIN_EVENTS) {
      expect(eventTierOf(ev.id), `${ev.id} 是奇缘阶段事件`).toBe('qiyuan')
    }
    for (const ev of FORTUNE_EVENTS) {
      expect(eventTierOf(ev.id), `${ev.id} 是机缘`).toBe('jiyuan')
    }
    const chainIds = new Set(CHAIN_EVENTS.map(e => e.id))
    const ordinary = EVENTS.filter(e => !chainIds.has(e.id) && !e.id.startsWith('ft_'))
    expect(ordinary.length, '一件寻常际遇都没有?那这个池子只剩稀有货了').toBeGreaterThan(0)
    for (const ev of ordinary) expect(eventTierOf(ev.id)).toBe('jingyu')
  })
})

describe('三档触发 · 概率模型', () => {
  it('三档概率之和 = 「出事」的概率 —— 旧模型正是在这里露馅的(0.211 > 0.16)', () => {
    for (const pending of [false, true]) {
      const sum = Object.values(tierChances(pending)).reduce((a, b) => a + b, 0)
      expect(sum, `缘${pending ? '在续' : '未起'}时的三档概率之和`).toBeCloseTo(EXPLORE_EVENT_CHANCE, 12)
    }
  })

  it('缘未起时奇缘根本不出现;缘在续时际遇 > 奇缘 > 机缘', () => {
    const closed = tierChances(false)
    expect(closed.qiyuan, '没有待走的下一程,奇缘不该有概率').toBe(0)
    const open = tierChances(true)
    console.log(
      `\n  缘在续:际遇 ${(open.jingyu * 100).toFixed(1)}% · 奇缘 ${(open.qiyuan * 100).toFixed(1)}% · 机缘 ${(open.jiyuan * 100).toFixed(2)}%` +
        `\n  缘未起:际遇 ${(closed.jingyu * 100).toFixed(1)}% · 机缘 ${(closed.jiyuan * 100).toFixed(2)}%`
    )
    expect(open.jingyu).toBeGreaterThan(open.qiyuan)
    expect(open.qiyuan).toBeGreaterThan(open.jiyuan)
    expect(open.jiyuan).toBeLessThan(0.01)
    expect(closed.jiyuan).toBeLessThan(0.01)
  })

  it('档位越罕见,期望次数越大 —— rarity 序不许与概率序打架', () => {
    const byRarity = [...EVENT_TIERS].sort((a, b) => a.rarity - b.rarity)
    const waits = byRarity.map(t => tierEncountersPerTrigger(t.id, true))
    for (let i = 1; i < waits.length; i += 1) {
      expect(waits[i], `${byRarity[i]!.name} 比 ${byRarity[i - 1]!.name} 更罕见,等的时间却更短`).toBeGreaterThan(
        waits[i - 1]!
      )
    }
  })

  it('三档各自说得出「多久见一次」;奇缘无缘在续时报「暂无」', () => {
    for (const t of EVENT_TIERS) {
      expect(tierOddsText(t.id, true)).toContain('程')
      expect(tierOddsText(t.id, false)).toBeTruthy()
    }
    expect(tierOddsText('qiyuan', false)).toBe('暂无')
    // 缘分状态会改变读数
    expect(tierOddsText('jingyu', false)).not.toBe(tierOddsText('jingyu', true))
    expect(tierOddsText('jiyuan', false)).not.toBe(tierOddsText('jiyuan', true))
  })

  /** pickEventFor 只答「出事之后是哪一档」:固定种子各跑两万次,占比与 tierChances 归一化后逐档比 */
  it('模型 = 引擎(蒙特卡洛):两万次真实抽取,三档占比逐档对得上', () => {
    const region = regionDef('qingyun')!
    const run = (stagePending: boolean): { counts: Record<EventTier, number>; total: number } => {
      setActivePinia(createPinia())
      const player = usePlayerStore()
      // pendingChainStages 扫所有链:须先把全部链走完,再按需重开第一条
      for (const chain of CHAINS) player.setEventChain(chain.id, chain.stages.length)
      if (stagePending) player.setEventChain(CHAINS[0]!.id, 0)
      const rand = new RandomService(mulberry32(0xc0ffee))
      const counts: Record<EventTier, number> = { jingyu: 0, jiyuan: 0, qiyuan: 0 }
      let total = 0
      for (let i = 0; i < 20000; i += 1) {
        const ev = pickEventFor(region, rand)
        if (!ev) continue
        counts[eventTierOf(ev.id)] += 1
        total += 1
      }
      return { counts, total }
    }
    for (const pending of [false, true]) {
      const { counts, total } = run(pending)
      const model = tierChances(pending)
      const pct = (v: number): string => (v * 100).toFixed(2)
      console.log(
        `\n  缘${pending ? '在续' : '未起'}(${total} 次出事):` +
          ` 引擎 际遇 ${pct(counts.jingyu / total)}% · 奇缘 ${pct(counts.qiyuan / total)}% · 机缘 ${pct(counts.jiyuan / total)}%` +
          ` ｜ 模型 ${pct(model.jingyu / EXPLORE_EVENT_CHANCE)}% / ${pct(model.qiyuan / EXPLORE_EVENT_CHANCE)}% /` +
          ` ${pct(model.jiyuan / EXPLORE_EVENT_CHANCE)}%`
      )
      expect(total, '两万次里出事太少?抽样出了岔子').toBeGreaterThan(15000)
      for (const tier of PILLARS) {
        const engineShare = counts[tier] / total
        const modelShare = model[tier] / EXPLORE_EVENT_CHANCE
        expect(
          Math.abs(engineShare - modelShare),
          `${tier} 占比:引擎 ${engineShare.toFixed(3)} vs 模型 ${modelShare.toFixed(3)}`
        ).toBeLessThan(0.02)
      }
    }
  })

  it('三档的名字、颜色各不相同(否则「区分度」只是嘴上说)', () => {
    expect(new Set(EVENT_TIERS.map(t => t.name)).size).toBe(3)
    expect(new Set(EVENT_TIERS.map(t => t.color)).size).toBe(3)
    expect(eventTierDef('qiyuan').name).toBe('奇缘')
    expect(eventTierDef('jiyuan').name).toBe('机缘')
    expect(eventTierDef('jingyu').name).toBe('际遇')
  })
})

describe('三档触发 · 接线', () => {
  const src = (p: string): string => readFileSync(resolve(__dirname, p), 'utf8')

  it('弹窗读的是 core/eventTier,不是自己那张档位表', () => {
    const dialog = src('../components/adventure/EventDialog.vue')
    expect(dialog, '档位名必须取自 eventTierDef').toContain('eventTierDef(')
    expect(dialog, '事件属于哪一档必须取自 eventTierOf').toContain('eventTierOf(')
    expect(dialog, '概率文案必须取自 tierOddsText').toContain('tierOddsText(')
    expect(dialog, '概率要按"此刻有没有缘在续"算').toContain('chainPending')
    expect(dialog, '弹窗标题又被写死成「际遇」了').not.toMatch(/:title="result \? '际遇'/)
  })

  it('历练页出发前就把三档与稀度摆出来,且同样按缘分状态算', () => {
    const view = src('../views/AdventureView.vue')
    expect(view, '该把三档摆在出发之前').toContain('EVENT_TIERS')
    expect(view, '档位胶囊的文字该取自同一份概率口径').toContain('tierOddsText(')
    expect(view, '稀度要按当前缘分状态算').toContain('pendingChainStages(')
    // 故障注入:把 EVENT_TIERS.length 改成字面量 3,本用例红
    expect(view, '档数应由 EVENT_TIERS 现算').toContain('途中{{ cnNumber(EVENT_TIERS.length) }}档')
    expect(view, '不许再把档数写死成三档').not.toContain('途中三档')

    // 剥掉注释,判据只看渲染正文
    const dialog = src('../components/adventure/ExploreModeDialog.vue')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
    expect(dialog, '出行弹窗的档数也应现算').toContain('途中{{ cnNumber(EVENT_TIERS.length) }}档')
    expect(dialog, '弹窗也不许写死三档').not.toContain('途中三档')
    expect(dialog, '弹窗的档位名应由 EVENT_TIERS 渲染,不再手写三个名字').toContain(
      'v-for="(t, i) in EVENT_TIERS"'
    )
  })

  it('概率常量只有一份 —— 引擎与界面不许各写一个', () => {
    const engine = src('./eventEngine.ts')
    expect(engine).toContain('CHAIN_STAGE_CHANCE')
    expect(engine).toContain('FORTUNE_CHANCE')
    expect(engine, '概率又被写死在引擎里了').not.toMatch(/const (FORTUNE_CHANCE|CHAIN_STAGE_CHANCE)\s*=/)
  })
})

describe('际遇概览(anyChance 入参 = 引擎真掷同一条乘链)', () => {
  it('抬高基础(星象/福缘/区域事件 eventMult)按同倍率放大各档,「约每 N 程」随之减少', () => {
    // stagePending=true 时奇缘档非零,三档断言才不空转
    const base = tierChances(true)
    const x2 = EXPLORE_EVENT_CHANCE * 2
    const boosted = tierChances(true, x2)
    expect(boosted.qiyuan).toBeCloseTo(base.qiyuan * 2, 9)
    expect(boosted.jiyuan).toBeCloseTo(base.jiyuan * 2, 9)
    expect(boosted.jingyu).toBeCloseTo(base.jingyu * 2, 9)
    expect(tierEncountersPerTrigger('qiyuan', true, x2)).toBeLessThan(tierEncountersPerTrigger('qiyuan', true))
    // 文案层也须吃 anyChance
    expect(tierEncountersPerTrigger('jingyu', true, x2)).toBeLessThan(tierEncountersPerTrigger('jingyu', true))
    expect(tierOddsText('jingyu', true, x2)).not.toBe(tierOddsText('jingyu', true))
    // 缺省 = 裸基础
    expect(tierChances(true)).toEqual(base)
  })
})
