/**
 * 闲趣三则的展示口径:签等配色、篓中是否有货、还剩几竿、谜面判词。
 *
 * 只管「怎么说」,不管「给多少」—— 赏格一律以服务端返回为准,界面不自行折算。
 */
import type { LeisureReward } from '@/services/cloud'

/** 签等文字色:大吉朱、吉金、小吉青、平淡墨 */
export function fortuneTone(rank: number): string {
  if (rank >= 3) return 'text-cinnabar'
  if (rank === 2) return 'text-gold-ink'
  if (rank === 1) return 'text-azure'
  return 'text-ink-faint'
}

/** 篓中是否有货(六项全零即空竿到底) */
export function basketEmpty(r: LeisureReward): boolean {
  return r.stone + r.herb + r.wudao + r.ore + r.dust + r.page <= 0
}

/** 还剩几竿 */
export function castHint(casts: number, max: number): string {
  const left = Math.max(0, Math.trunc(max) - Math.max(0, Math.trunc(casts)))
  if (left <= 0) return '今日竿已收'
  if (left === 1) return '只余一竿'
  if (left === 2) return '还可起两竿'
  return `还可起${left}竿`
}

/** 谜面判词:未答 / 答对 / 答错 */
export function riddleVerdict(answered: boolean, correct: boolean | null): string {
  if (!answered) return '尚未作答'
  return correct === true ? '答对了' : '答错了'
}
