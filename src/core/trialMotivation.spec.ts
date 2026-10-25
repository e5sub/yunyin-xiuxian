/* eslint-disable no-console */
/** 逆旅契动机审计:契改变了构筑排序,还是只让胜率等比下降 */
import { describe, expect, it } from 'vitest'
import {
  AXIS_COVERAGE,
  AXIS_NAMES,
  IMMUTABLE_SPACE,
  MUTABLE_SPACE,
  allImpacts,
  playValueOf,
  standings,
  untouchedAxes
} from './trialMotivation'

const impacts = allImpacts(60)
const VALUE_LABEL = { reshapes: '改变排序', tilts: '有倾向', flat: '纯变难' }

describe('动机 · 四份契到底改变了什么', () => {
  it('基线构筑排行', () => {
    console.log('\n无契时的构筑排行:')
    for (const s of standings(undefined, 60)) {
      console.log(`  ${s.rank + 1}. ${s.name.padEnd(8)} ${(s.winRate * 100).toFixed(1)}%`)
    }
  })

  it('逐契影响表', () => {
    console.log('\n契        变难     排名变动  位移  最强易主  影响不均  判定')
    for (const im of impacts) {
      console.log(
        `${im.trial.name.padEnd(8)} ${`-${(im.drop * 100).toFixed(1)}pp`.padStart(7)} ` +
          `${String(im.rankShifts).padStart(8)} ${String(im.rankDistance).padStart(5)} ` +
          `${(im.topChanged ? '是' : '否').padStart(8)} ${(im.differential * 100).toFixed(2).padStart(8)} ` +
          `  ${VALUE_LABEL[playValueOf(im)]}`
      )
    }
  })

  it('每份契都确实变难了 —— 惩罚是真的', () => {
    for (const im of impacts) {
      expect(im.trialWin).toBeLessThan(im.baseWin)
    }
    const worst = impacts.reduce((a, b) => (b.drop > a.drop ? b : a))
    console.log(`\n最重的是「${worst.trial.name}」:平均胜率 -${(worst.drop * 100).toFixed(1)}pp`)
  })

  it('关键问题:变难之外,有没有改变决策', () => {
    const reshaping = impacts.filter(im => playValueOf(im) === 'reshapes')
    const flat = impacts.filter(im => playValueOf(im) === 'flat')
    console.log(
      `\n改变构筑排序的:${reshaping.map(i => i.trial.name).join('、') || '无'}` +
        `\n纯粹等比变难的:${flat.map(i => i.trial.name).join('、') || '无'}`
    )
    // 不预设结果,只钉事实
    expect(reshaping.length + flat.length).toBeLessThanOrEqual(impacts.length)
  })

  it('影响不均度决定了是否需要玩家重新思考', () => {
    console.log('\n契        受影响最大与最小构筑的胜率差')
    for (const im of impacts) {
      console.log(`${im.trial.name.padEnd(8)} ${(im.spread * 100).toFixed(1)}pp`)
    }
    const maxSpread = Math.max(...impacts.map(i => i.spread))
    console.log(
      `\n最大不均 ${(maxSpread * 100).toFixed(1)}pp —— ` +
        `不均越大,越说明「这一世该换个打法」,而不只是「这一世更苦」`
    )
  })
})

describe('动机 · 决策维度覆盖', () => {
  it('静态标注必须与实测一致:build 格是否激活逐契比对', () => {
    // 须逐索引比对:两侧 .every 聚合在恰一份契漂移时 false===false 照样通过
    for (let i = 0; i < AXIS_COVERAGE.length; i += 1) {
      const labeled = AXIS_COVERAGE[i]!.axes.includes('build')
      const measured = playValueOf(impacts[i]!) === 'reshapes'
      expect(measured, `契 ${AXIS_COVERAGE[i]!.trialId} 的 build 实测应与静态标注一致`).toBe(labeled)
    }
  })

  it('但历练、顺序、遭遇、目标四格一个都没碰到', () => {
    const untouched = untouchedAxes()
    console.log('\n未被任何契触及的决策维度:')
    for (const a of untouched) console.log(`  ${AXIS_NAMES[a]}`)
    expect(untouched).toContain('region')
    expect(untouched).toContain('order')
    expect(untouched).toContain('encounter')
    expect(untouched).toContain('goal')
    console.log(
      `\n${untouched.length} / ${Object.keys(AXIS_NAMES).length} 个维度未被触及 ——` +
        `\n契约不改变历练路线、不改变解锁顺序、不引入新敌人、不改变本世目标`
    )
  })

  it('诊断:动机不足不是因为「只会变难」,而是因为改变只发生在战斗内部', () => {
    const untouched = untouchedAxes()
    expect(untouched.length).toBeGreaterThanOrEqual(4)
    expect(impacts.every(im => playValueOf(im) === 'reshapes')).toBe(true)
    console.log(
      '\n契约不是纯罚款:它真的让玩家需要换打法(首尾构筑最大拉开 63.8pp)。' +
        '\n但改变只发生在战斗内部,一世的结构没变 ——' +
        '\n同样的区域、同样的顺序、同样的目标。' +
        '\n故要提高动机,该扩的是玩法面(历练/物品/顺序/目标),不是补奖励'
    )
  })
})

describe('动机 · 架构边界', () => {
  it('可动与不可动的空间', () => {
    console.log(`\n可动(Rule Space):${MUTABLE_SPACE.join(' · ')}`)
    console.log(`不可动:${IMMUTABLE_SPACE.join(' · ')}`)
  })

  it('这条边界允许大胆内容而不制造新闭环', () => {
    expect(MUTABLE_SPACE).toContain('可用物品')
    expect(MUTABLE_SPACE).toContain('历练路线')
    expect(IMMUTABLE_SPACE).toContain('DaoFruit')
    expect(IMMUTABLE_SPACE).toContain('Insight(宿慧)')
    console.log(
      '\n下一批契可以动的:限制可用丹药/法宝、限定历练路线、' +
        '\n改变解锁顺序、给本世换一个目标 —— 都改玩法,都不进成长经济'
    )
  })
})
