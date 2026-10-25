/** 仙路旅途:按当前境判出 21 境刻度每境的三态与界首标记(纯函数;四界首 0/9/14/18 由测试钉住) */
import { REALMS, WORLDS, isWorldEntry, MAX_MAJOR } from '@/data/realms'

export type RealmLadderState = 'done' | 'now' | 'future'

export interface RealmLadderPoint {
  /** 境界索引(major),0~20 */
  index: number
  name: string
  /** 是否界首(人间/仙界/神界/混沌海的第一境) */
  worldStart: boolean
  state: RealmLadderState
}

export interface RealmLadderWorld {
  id: string
  name: string
  start: number
  end: number
  /** 本段在整条刻度上的中心位置(0~100%,界名钉在此);四界段长不一,不用均布(justify-between) */
  centerPct: number
}

/** 21 境刻度;越界 major 先修正(与 realmDef 同口径)再判三态 */
export function realmLadderPoints(major: number): RealmLadderPoint[] {
  const m = Math.max(0, Math.min(MAX_MAJOR, major))
  return REALMS.map((r, i) => ({
    index: i,
    name: r.name,
    worldStart: isWorldEntry(i),
    state: i < m ? 'done' : i === m ? 'now' : 'future'
  }))
}

/** 四界段位:界名、首尾索引取自 data;段心 = ((a+b)/2+0.5)/21×100(格心在 +0.5) */
export function realmLadderWorlds(): RealmLadderWorld[] {
  return WORLDS.map(w => ({
    id: w.id,
    name: w.name,
    start: w.start,
    end: w.end,
    centerPct: (((w.start + w.end) / 2 + 0.5) / REALMS.length) * 100
  }))
}
