/* eslint-disable no-console -- 软阈值审计报告 */
import { describe, expect, it } from 'vitest'
import { ENEMY_ARCHETYPES, fullMatrix, type MatrixRow } from './buildSim'
import { searchBuilds } from './buildSearch'

const N = 80 // 每流派 × 每敌型的场次

function cell(rows: MatrixRow[], buildId: string, archId: string): number {
  return rows.find(r => r.build.id === buildId)!.cells[archId]!.winRate
}

describe('Phase 30.4:软阈值对流派生态的影响审计', () => {
  const matrix = fullMatrix(N)
  const searchReport = searchBuilds(1000, 20)

  it('输出当前流派生态 baseline(含软阈值)', () => {
    console.log('\n—— Phase 30.4 流派生态 Baseline(含软阈值) ——')
    console.log('  流派 × 敌型胜率矩阵(各 ' + N + ' 场):')

    const header = ['流派  ', ...ENEMY_ARCHETYPES.map(a => a.name.padStart(4, ' ')), '  均值'].join(' | ')
    console.log('  ' + header)

    for (const row of matrix) {
      const cells = ENEMY_ARCHETYPES.map(a => `${Math.round(row.cells[a.id]!.winRate * 100)}%`.padStart(4, ' '))
      console.log(`  ${row.build.name} | ${cells.join(' | ')} | ${Math.round(row.avgWinRate * 100)}%`)
    }

    console.log('\n  随机构筑搜索统计(1000 构筑 × 140 场):')
    console.log(`    战力-胜率相关系数 r = ${searchReport.powerCorrelation.toFixed(2)}`)
    console.log(`    万金油构筑: ${searchReport.universals.length} (${(searchReport.universals.length / 10).toFixed(1)}%)`)
    console.log(`    陷阱构筑: ${searchReport.traps.length} (${(searchReport.traps.length / 10).toFixed(1)}%)`)

    expect(matrix.length).toBe(6)
  })

  it('流派均衡性:无废柴也无霸主(45%-88%)', () => {
    for (const row of matrix) {
      expect(row.avgWinRate, `${row.build.name} 综合胜率`).toBeGreaterThan(0.45)
      expect(row.avgWinRate, `${row.build.name} 综合胜率`).toBeLessThan(0.88)
    }

    const avgs = matrix.map(r => r.avgWinRate)
    const range = Math.max(...avgs) - Math.min(...avgs)
    expect(range, '流派胜率极差').toBeLessThan(0.3)
  })

  it('罡盾审计:是否因减伤软阈值进一步变强', () => {
    const gangdun = matrix.find(r => r.build.id === 'gangdun')!
    expect(gangdun.avgWinRate, '罡盾综合胜率').toBeLessThan(0.82)

    const rates = ENEMY_ARCHETYPES.map(a => gangdun.cells[a.id]!.winRate)
    const best = Math.max(...rates)
    const pierce = gangdun.cells.pierce!.winRate
    expect(best - pierce, '罡盾·真伤短板').toBeGreaterThan(0.12)
  })

  it('背水审计:是否因生命软阈值被过度削弱', () => {
    const beishui = matrix.find(r => r.build.id === 'beishui')!
    const lianji = matrix.find(r => r.build.id === 'lianji')!
    const fengmang = matrix.find(r => r.build.id === 'fengmang')!

    expect(beishui.avgWinRate, '背水综合胜率').toBeGreaterThan(0.45)

    const beishuiBoss = beishui.cells.boss!.winRate
    const lianjiBoss = lianji.cells.boss!.winRate
    const fengmangBoss = fengmang.cells.boss!.winRate
    expect(beishuiBoss, '背水攻坚优于连击').toBeGreaterThan(lianjiBoss + 0.1)
    expect(beishuiBoss, '背水攻坚优于锋芒').toBeGreaterThan(fengmangBoss + 0.1)
  })

  it('连击审计:是否因速度软阈值受过大影响', () => {
    const lianji = matrix.find(r => r.build.id === 'lianji')!
    expect(lianji.avgWinRate, '连击综合胜率').toBeGreaterThan(0.45)

    const normal = lianji.cells.normal!.winRate
    const dodge = lianji.cells.dodge!.winRate
    expect(normal - dodge, '连击·疾影克制').toBeGreaterThan(0.12)
  })

  it('锋芒审计:是否因攻击软阈值被压制', () => {
    const fengmang = matrix.find(r => r.build.id === 'fengmang')!
    expect(fengmang.avgWinRate, '锋芒综合胜率').toBeGreaterThan(0.45)

    const boss = fengmang.cells.boss!.winRate
    expect(boss, '锋芒攻坚短板').toBeLessThan(0.4)
  })

  it('沐泽审计:生命/续航软阈值是否产生新破墙', () => {
    const muze = matrix.find(r => r.build.id === 'muze')!
    expect(muze.avgWinRate, '沐泽综合胜率').toBeGreaterThan(0.45)

    const boss = muze.cells.boss!.winRate
    const burst = muze.cells.burst!.winRate
    expect(boss - burst, '沐泽·久战优势').toBeGreaterThan(0.08)
  })

  it('万金油红线:破墙构筑占比 ≤1.5%(软阈值不应加剧问题)', () => {
    const universalRate = searchReport.universals.length / searchReport.results.length
    expect(universalRate, '破墙构筑占比').toBeLessThanOrEqual(0.015)
  })

  it('战力-胜率解耦:相关系数应维持在健康区间(0.15-0.92)', () => {
    expect(searchReport.powerCorrelation, '战力-胜率相关系数').toBeGreaterThan(0.15)
    expect(searchReport.powerCorrelation, '战力-胜率相关系数').toBeLessThan(0.92)
  })

  it('克制关系存续:软阈值不应模糊既有克制矩阵', () => {
    // 破盾斩杀:罡盾怕真伤
    const gangdun = matrix.find(r => r.build.id === 'gangdun')!
    const gdRates = ENEMY_ARCHETYPES.map(a => gangdun.cells[a.id]!.winRate)
    expect(Math.max(...gdRates) - gangdun.cells.pierce!.winRate).toBeGreaterThan(0.12)

    // 反震吃多段
    expect(cell(matrix, 'fanzhen', 'multi')).toBeGreaterThan(cell(matrix, 'fanzhen', 'dodge') + 0.12)

    // 连击怕闪避
    expect(cell(matrix, 'lianji', 'normal')).toBeGreaterThan(cell(matrix, 'lianji', 'dodge') + 0.12)
  })
})
