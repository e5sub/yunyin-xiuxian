/** Boss 机制家族(8 种) */

import type { BossArchetype, BossPhase, EnemySkill, StatMods } from '@/types'

export interface ArchetypeDef {
  id: BossArchetype
  name: string
  seal: string
  desc: string
  coreMods: StatMods
  coreSkills: EnemySkill[]
  phases: BossPhase[]
  /** 攻/防/血倍率,相对标准 Boss */
  statPersonality: { atkMult: number; defMult: number; hpMult: number }
}

export const ARCHETYPES: Record<BossArchetype, ArchetypeDef> = {
  berserk: {
    id: 'berserk',
    name: '狂暴型',
    seal: '狂',
    desc: '越战越强,持续输出压力',
    coreMods: { damageBonus: 0.3 },
    coreSkills: [{ name: '狂暴重击', mult: 2.2, rate: 0.35 }],
    phases: [
      {
        hpThreshold: 0.5,
        modChanges: { damageBonus: 0.6 },
        skillChanges: [{ name: '狂化·裂空', mult: 2.6, rate: 0.4 }],
        label: '狂化'
      }
    ],
    statPersonality: { atkMult: 1.2, defMult: 0.9, hpMult: 1.0 }
  },
  counter: {
    id: 'counter',
    name: '反制型',
    seal: '反',
    desc: '受连击触发反击,惩罚多段输出',
    coreMods: { counterRate: 0.35, counterDamage: 0.5 },
    coreSkills: [{ name: '反刃', mult: 1.8, rate: 0.2 }],
    phases: [],
    statPersonality: { atkMult: 1.0, defMult: 1.2, hpMult: 1.0 }
  },
  truedmg: {
    id: 'truedmg',
    name: '真伤型',
    seal: '真',
    desc: '关键真伤窗口,考验护盾以外的生存',
    coreMods: {},
    coreSkills: [{ name: '裂魂', mult: 1.5, rate: 0.3, effect: 'pierce' }],
    phases: [
      {
        hpThreshold: 0.6,
        skillChanges: [{ name: '裂魂·贯体', mult: 2.0, rate: 0.35, effect: 'pierce' }],
        label: '裂魂'
      }
    ],
    statPersonality: { atkMult: 1.1, defMult: 1.0, hpMult: 1.1 }
  },
  antiheal: {
    id: 'antiheal',
    name: '治疗压制型',
    seal: '禁',
    desc: '压制治疗,考验续航以外的手段',
    coreMods: { damageBonus: 0.1 },
    coreSkills: [{ name: '枯灭之息', mult: 1.3, rate: 0.3 }],
    phases: [
      {
        hpThreshold: 0.7,
        skillChanges: [{ name: '枯灭领域', mult: 1.6, rate: 0.35 }],
        label: '枯灭领域'
      }
    ],
    statPersonality: { atkMult: 0.9, defMult: 1.3, hpMult: 1.2 }
  },
  spellbane: {
    id: 'spellbane',
    name: '吞法型',
    seal: '噬',
    desc: '神通越多越强,惩罚技能堆砌',
    coreMods: { damageReduction: 0.2 },
    coreSkills: [{ name: '噬法之噬', mult: 1.5, rate: 0.3 }],
    phases: [],
    statPersonality: { atkMult: 1.0, defMult: 1.1, hpMult: 1.1 }
  },
  evasive: {
    id: 'evasive',
    name: '闪避型',
    seal: '影',
    desc: '高闪避,命中检查',
    coreMods: { dodgeRate: 0.35 },
    coreSkills: [{ name: '幻影突袭', mult: 1.8, rate: 0.25 }],
    phases: [
      {
        hpThreshold: 0.5,
        modChanges: { dodgeRate: 0.5 },
        label: '虚影'
      }
    ],
    statPersonality: { atkMult: 0.95, defMult: 1.0, hpMult: 1.15 }
  },
  attrition: {
    id: 'attrition',
    name: '消耗型',
    seal: '耗',
    desc: '长战压迫,拖垮输出节奏',
    coreMods: { regenPerRound: 0.02 },
    coreSkills: [{ name: '侵蚀之息', mult: 1.2, rate: 0.4 }],
    phases: [],
    statPersonality: { atkMult: 0.85, defMult: 1.4, hpMult: 1.3 }
  },
  threshold: {
    id: 'threshold',
    name: '门槛型',
    seal: '门',
    desc: '特定属性准备不足,进入不利状态',
    coreMods: { shieldOnStart: 0.3 },
    coreSkills: [{ name: '护法威压', mult: 1.6, rate: 0.25 }],
    phases: [],
    statPersonality: { atkMult: 1.1, defMult: 1.2, hpMult: 0.95 }
  }
}
