/**
 * 功法副席:辅修与秘术**各算各的账**。
 *
 * 旧账法把两门类塞进同一个预算(藏经阁每三级多一席),于是藏经阁未升时只能挂一本 ——
 * 挂了一本辅修就再挂不上秘术,玩家看到的是「两个门类只能装一个」。二者本是两回事:
 * 辅修靠藏书养,秘术靠机缘得,抢同一把椅子不合理。
 *
 * 今定:辅修席 = 藏经阁预算(至少 1),秘术席 = 固定 1。两席并存,一件秘术不再挤掉一件辅修。
 * 超席的选择仍留在列表里(藏经阁缩水/转世后按装载顺序回升),只是不出词条 ——
 * 这条口径被 cultivation.gongfaMods / buildDetect / loadoutService 三处共用,故收在此处一份。
 */
import { gongfaDef } from '@/data/gongfa'

/** 秘术席数:固定一席,不随藏经阁涨 */
export const SECRET_SEATS = 1

function sanitizeSeats(seats: number): number {
  return Number.isFinite(seats) ? Math.max(0, Math.floor(seats)) : 0
}

/** 某本功法占几个席面:主修 0(主修另有一席)、秘术看 SECRET_SEATS、辅修看藏经阁预算;未知门类 0 */
export function seatCapOf(id: string, subSeats: number): number {
  const type = gongfaDef(id)?.type
  if (type === 'secret') return SECRET_SEATS
  if (type === 'sub') return sanitizeSeats(subSeats)
  return 0
}

/**
 * 真正生效的副席(按装配顺序;辅修、秘术各自封顶)。
 * 未习得/查无此门的 id 不计 —— 调用方即便塞进脏数据,也不会白吃一席。
 */
export function effectiveSubs(ids: readonly string[], subSeats: number): string[] {
  const subCap = sanitizeSeats(subSeats)
  let subs = 0
  let secrets = 0
  const out: string[] = []
  for (const id of ids) {
    const type = gongfaDef(id)?.type
    if (type === 'sub') {
      if (subs >= subCap) continue
      subs += 1
      out.push(id)
    } else if (type === 'secret') {
      if (secrets >= SECRET_SEATS) continue
      secrets += 1
      out.push(id)
    }
  }
  return out
}

/** 某门类现有几本在席(不含超席) */
export function seatedCount(ids: readonly string[], type: 'sub' | 'secret', subSeats: number): number {
  return effectiveSubs(ids, subSeats).filter(id => gongfaDef(id)?.type === type).length
}

/**
 * 还能不能再添这一本。主修门类、已在列表里的、查无此门的都不行;
 * 席面按**自己那一门**算,故「辅修满了」不妨碍再挂一本秘术。
 */
export function canSeat(ids: readonly string[], id: string, subSeats: number): boolean {
  const type = gongfaDef(id)?.type
  if (type !== 'sub' && type !== 'secret') return false
  if (ids.includes(id)) return false
  const cap = type === 'secret' ? SECRET_SEATS : sanitizeSeats(subSeats)
  return seatedCount(ids, type, subSeats) < cap
}
