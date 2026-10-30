/**
 * 围妖出剑难度档:与 server/src/routes/boss.ts 的 BOSS_DIFFICULTY 同一套数字。
 * 妖王越凶(攻势越猛,削血越难),击杀赏格越厚——出剑无资粮,推倒妖王才论功行赏。
 * 仅供展示与入参校验;结算权威在服务端,两处数字漂移时以服务端为准。
 */
export type BossDifficulty = 'calm' | 'normal' | 'peril'

export interface BossDifficultyOption {
  key: BossDifficulty
  name: string
  /** 妖王攻势倍率(越高越容易被砍退,削血越少) */
  atk: number
  /** 击杀赏格倍率(均分时乘在自己份上) */
  kill: number
  desc: string
}

export const BOSS_DIFFICULTY_OPTIONS: BossDifficultyOption[] = [
  {
    key: 'calm',
    name: '循境',
    atk: 0.8,
    kill: 1,
    desc: '妖王气焰稍敛:攻势 ×0.8,削血更稳,击杀赏 ×1'
  },
  {
    key: 'normal',
    name: '常探',
    atk: 1,
    kill: 1.5,
    desc: '与本境相称的常道:攻势 ×1,击杀赏 ×1.5'
  },
  {
    key: 'peril',
    name: '绝境',
    atk: 1.35,
    kill: 2.5,
    desc: '直面妖王凶焰:攻势 ×1.35,削血更险,击杀赏 ×2.5'
  }
]

export function isBossDifficulty(v: unknown): v is BossDifficulty {
  return v === 'calm' || v === 'normal' || v === 'peril'
}

/** 宽松解析(脏值按常探) */
export function bossDifficultyOf(v: unknown): BossDifficulty {
  return isBossDifficulty(v) ? v : 'normal'
}
