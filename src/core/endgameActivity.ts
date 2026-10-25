/**
 * 终局「同一时刻只走一条路」的唯一判据;核心与界面共用,拒绝文案只写在这里。
 * 远征、秘境、历练与付费终局战斗(挑战书/试炼/变数/重写)若两处在途,战报、携带气血与扣费会串线。
 * 纯判定:在途状态由调用方传入,core 不反向 import store。
 */

export interface EndgameBusy {
  kind: 'expedition' | 'secretRealm' | 'exploration'
  reason: string
}

/** 当前是否已有在途终局活动;没有则返回 null */
export function endgameBusy(worldRun: unknown, secretRealm: unknown, adventureSession: unknown): EndgameBusy | null {
  if (worldRun) {
    return { kind: 'expedition', reason: '远征在途' }
  }
  if (secretRealm) {
    return { kind: 'secretRealm', reason: '身在秘境' }
  }
  if (adventureSession) {
    return { kind: 'exploration', reason: '历练在途' }
  }
  return null
}
