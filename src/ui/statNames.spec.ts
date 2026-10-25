/**
 * 属性面板展示诚实契约,锁完整性(signedPercent.spec 只测单条措辞)。
 * 掷点/闸门类词条(叠在固有基数上、或靠阈值/门槛生效)须在 STAT_CAVEATS 配说明
 * (statValueText 拼成「+N%(说明)」);只有纯乘性加成(攻/防/血、伤害倍率)可裸报「+N%」。
 */
import { describe, expect, it } from 'vitest'
import { statCaveat, statValueText } from '@/data/statNames'
import { CRIT_BASE, CRIT_DMG_BASE } from '@/data/constants'
import { formatPercent } from '@/utils/format'

/**
 * 掷点/闸门类词条,来源:
 *  combat.ts:critRate / critDamage 叠固有基数,闪避/命中相减后掷点,counter/combo/stun 各掷一次,
 *    先手 1+speed ≥ 敌速,firstStrike 只改第一回合,armorPen 削防后入减免(非真伤);
 *  其余为门槛词条与 loot/事件判定。
 */
const ROLL_OR_GATE: readonly string[] = [
  'critRate',
  'critDamage',
  'dodgeRate',
  'accuracy',
  'counterRate',
  'comboRate',
  'stunRate',
  'speed',
  'firstStrike',
  'armorPen',
  'lowHpDamage',
  'lowHpReduction',
  'fullHpDamage',
  'executeDamage',
  'doubleDropRate',
  'eventLuck',
  'explorationSpeed',
  'tribulationResist',
  'breakthroughRate',
  'breakRefund',
  'shieldOnStart',
  'lifesteal',
  'regenPerRound'
]

describe('属性面板展示诚实契约', () => {
  it('掷点/闸门类词条一律带说明,不得裸报成加号数(叠基/阈值/门槛必须讲清)', () => {
    for (const key of ROLL_OR_GATE) {
      const caveat = statCaveat(key)
      expect(caveat, `${key} 是掷点/闸门词条,必须配 STAT_CAVEATS 说明`).toBeTruthy()
      expect(statValueText(key as never, 0.1), `${key} 应渲染成 带说明 形式`).toContain('(')
    }
  })

  it('带说明的掷点词条:叠基的实实在在地报出固有基数(会心/会心之伤)', () => {
    expect(statValueText('critRate' as never, 0.1)).toBe(`+10%(叠于固有会心 ${formatPercent(CRIT_BASE)} 之上)`)
    expect(statValueText('critDamage' as never, 0.1)).toBe(
      `+10%(叠于固有会心之伤 ${formatPercent(CRIT_DMG_BASE)} 之上)`
    )
  })

  it('纯乘性加成(攻/防/血/伤害倍率)才允许裸报成加号数', () => {
    for (const key of ['attackPct', 'defensePct', 'maxHpPct', 'damageBonus']) {
      expect(statCaveat(key), `${key} 是纯乘性加成,不应配说明(裸报`).toBeFalsy()
      expect(statValueText(key as never, 0.2), `${key} 应裸报 +%`).toBe('+20%')
    }
  })
})
