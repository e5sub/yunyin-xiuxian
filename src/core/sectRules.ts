/**
 * 门派规则(纯账层):价目、耗时、捐献折算、等级上限与状态修形。
 *
 * 这一层是**客户端与服务端共用的唯一事实源**:服务端经 scripts/build-vendor.mjs 把它打进
 * server/vendor,算价与计时都读本文件 —— 客户端价签只是预览,不参与结算。
 *
 * 门派状态不进存档分片。理由与做法见 server/src/sectState.ts:
 * 贡献是服务端签发的货币,放进存档就等于「本地可写」;而它又能换永久属性(mods),
 * 所以整份状态只住在服务端,客户端每次只提交**动作**(捐什么、升哪座、学哪门)。
 */
import type { StatMods } from '@/types'
import {
  SECTS,
  SECT_BUILDINGS,
  SECT_BUILDING_GATE_MULT,
  SECT_DONATIONS,
  SECT_DONATE_DAILY_CAP,
  SECT_DONATE_VIP_CAP,
  SECT_FOUND_COST,
  SECT_FOUND_MAJOR,
  SECT_MEMBERS_BASE,
  SECT_MEMBERS_PER_LEVEL,
  SECT_NAME_MAX,
  SECT_NAME_MIN,
  SECT_POOL_SHARE,
  SECT_SKILL_COST_BASE,
  SECT_SKILL_COST_GROWTH,
  SECT_SKILL_MAX_LEVEL,
  sectBuildingDef,
  sectDef,
  sectSkillDef,
  type SectBuildingId,
  type SectId
} from '@/data/sect'
import { herbGradeOfMajor, type HerbGrade } from '@/data/herbGrades'
import { mergeMods } from './statsCalc'

/** 贡献上限:与其它货币同量级,只是防坏数把面板撑爆 */
export const SECT_POINT_MAX = 1e9

export interface SectBuildTask {
  id: SectBuildingId
  /** 目标等级(升完之后的等级) */
  to: number
  startAt: number
  finishAt: number
}

/**
 * 门派状态。`day`/`donationsToday` 是服务端按 UTC+8 日界维护的捐献限次,
 * 客户端仅用于显示「今日还剩几次」。
 */
export interface SectState {
  /** 道统(决定技能树):开宗立派时三选一,定后不再改 */
  sectId: SectId | null
  /** 门派名:玩家自取,二字至七字 */
  name: string
  /** 个人贡献:学技能用 */
  personal: number
  /** 门派库:升建筑用 */
  pool: number
  /** 技能 id → 等级(1~5) */
  skills: Record<string, number>
  /** 建筑 id → 等级(0~上限) */
  buildings: Record<string, number>
  /** 正在营造的那一座;null 表示空闲 */
  build: SectBuildTask | null
  /** 捐献日号 YYYY-MM-DD(UTC+8) */
  day: string
  donationsToday: number
  /** 累计捐献贡献(展示用,不影响数值) */
  totalDonated: number
}

export function emptySectState(): SectState {
  return {
    sectId: null,
    name: '',
    personal: 0,
    pool: 0,
    skills: {},
    buildings: {},
    build: null,
    day: '',
    donationsToday: 0,
    totalDonated: 0
  }
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function intIn(v: unknown, min: number, max: number): number {
  if (!isNum(v)) return min
  return Math.min(max, Math.max(min, Math.trunc(v)))
}

/* ---------------- 价目与耗时 ---------------- */

/**
 * 宗门是否存在(三选一的数据源;不另维护一份 id 清单 —— 门槛改一次就四处不同步,
 * 是这套代码反复吃过的亏)。
 */
export function sectExists(id: string): boolean {
  return sectDef(id) !== undefined
}

/** 到没到开宗立派的境界(元婴起) */
export function canFound(major: number): boolean {
  return Number.isFinite(major) && major >= SECT_FOUND_MAJOR
}

/**
 * 每日捐献次数上限:常驻 3 次,VIP 5 次。
 * 客户端显示「今日还剩几次」与服务端限次同源 —— 两处各写一个 5 迟早对不上。
 */
export function donationQuota(vip = false): number {
  return vip ? SECT_DONATE_VIP_CAP : SECT_DONATE_DAILY_CAP
}

/** 门人上限:山门定员,初始 10 人,山门每升一级 +1 人 */
export function memberCap(hallLevel: number): number {
  return SECT_MEMBERS_BASE + intIn(hallLevel, 0, 8) * SECT_MEMBERS_PER_LEVEL
}

/**
 * 门派名是否可用:去首尾空白后 2~7 字,不含换行与控制字符。
 * 不做敏感词表 —— 名字不参与任何数值与匹配,只在本门派面板显示;
 * 有人取了怪名,GM 后台可以改。
 */
export function sectNameOk(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false
  const name = raw.trim()
  if (name.length < SECT_NAME_MIN || name.length > SECT_NAME_MAX) return false
  // 控制字符(含换行、制表、零宽)与纯空白一律不收
  // 首尾带空白的原样退回(不替玩家悄悄裁一刀:名字会写进状态,前后不一致更难查)
  return !/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029]/.test(name) && raw === name
}

/** 九折系数:rate 由调用方按 VIP 传入(服务端 vipActive、客户端 auth.isVip),纯函数不读全局 */
function priceRate(rate: number): number {
  return Number.isFinite(rate) && rate > 0 && rate <= 1 ? rate : 1
}

/** 某门技能从 level 升到 level+1 的个人贡献价;满级/认不出 → null */
export function skillCost(skillId: string, level: number, rate = 1): number | null {
  const def = sectSkillDef(skillId)
  if (def === undefined) return null
  const lv = intIn(level, 0, SECT_SKILL_MAX_LEVEL)
  if (lv >= SECT_SKILL_MAX_LEVEL) return null
  const base = SECT_SKILL_COST_BASE[Math.min(def.row, SECT_SKILL_COST_BASE.length) - 1] ?? SECT_SKILL_COST_BASE[0]
  return Math.ceil(base * Math.pow(SECT_SKILL_COST_GROWTH, lv) * priceRate(rate))
}

/** 开宗立派的一次性开销(灵石/玄铁/悟道点),VIP 有效期内同样九折 */
export function foundCost(rate = 1): { stone: number; ore: number; wudao: number } {
  const r = priceRate(rate)
  return {
    stone: Math.ceil(SECT_FOUND_COST.stone * r),
    ore: Math.ceil(SECT_FOUND_COST.ore * r),
    wudao: Math.ceil(SECT_FOUND_COST.wudao * r)
  }
}

/**
 * 同层解锁条件:第 n 层(n ≥ 2)须先把 n-1 层那门练到 2 级。
 * 第 1 层无条件。返回的是「需要达到 2 级的那门技能」,不是本门。
 */
export function skillUnlockNeed(skillId: string): { id: string; level: number } | null {
  const def = sectSkillDef(skillId)
  if (def === undefined || def.row <= 1) return null
  for (const sect of SECTS) {
    const prev = sect.skills.find(s => s.row === def.row - 1)
    if (prev !== undefined && sect.skills.some(s => s.id === skillId)) return { id: prev.id, level: 2 }
  }
  return null
}

/** 建筑从 level 升到 level+1 的门派贡献价;满级/认不出 → null */
export function buildingCost(id: string, level: number, rate = 1): number | null {
  const def = sectBuildingDef(id)
  if (def === undefined) return null
  const lv = intIn(level, 0, def.maxLevel)
  if (lv >= def.maxLevel) return null
  return Math.ceil(def.costBase * Math.pow(lv + 1, 1.55) * priceRate(rate))
}

/** 建筑从 level 升到 level+1 的等待时长(毫秒);满级/认不出 → null */
export function buildingDurationMs(id: string, level: number): number | null {
  const def = sectBuildingDef(id)
  if (def === undefined) return null
  const lv = intIn(level, 0, def.maxLevel)
  if (lv >= def.maxLevel) return null
  return Math.ceil(def.timeBaseMin * 60_000 * Math.pow(lv + 1, 1.45))
}

/**
 * 建筑等级上限:山门是闸门,其余 = (山门等级 + 1) × 2,再与各自 maxLevel 取小。
 * 洞府(gongfaSeats 那套)与这里都是「主闸限副」,但门派闸更紧 —— 一世只建一遍。
 */
export function buildingLevelCap(id: string, hallLevel: number): number {
  const def = sectBuildingDef(id)
  if (def === undefined) return 0
  if (def.id === 'hall') return def.maxLevel
  return Math.min(def.maxLevel, (intIn(hallLevel, 0, 8) + 1) * SECT_BUILDING_GATE_MULT)
}

/* ---------------- 捐献 ---------------- */

/** 捐献档位;认不出 → undefined */
export function donationDef(kind: string): (typeof SECT_DONATIONS)[number] | undefined {
  return SECT_DONATIONS.find(d => d.kind === kind)
}

/**
 * 一次捐献的贡献拆分:三成入门派库,其余记个人。
 * 用减法而不是两处各乘 —— 两处 floor 加起来会少一点,久了账对不上。
 */
export function donationSplit(contribution: number): { personal: number; pool: number } {
  const total = Math.max(0, Math.trunc(contribution))
  const pool = Math.floor(total * SECT_POOL_SHARE)
  return { personal: total - pool, pool }
}

/** 灵草捐献按玩家当前境界的品阶收(与灵田产出同一档,不另立一套) */
export function donationHerbGrade(major: number): HerbGrade {
  return herbGradeOfMajor(major)
}

/* ---------------- 属性 ---------------- */

/** 门派给的属性:技能各按现值 + 建筑各按现值,合成一份(与洞府 buildingMods 同规) */
export function sectMods(
  sectId: string | null,
  skills: Record<string, number>,
  buildings: Record<string, number>
): StatMods {
  const sources: StatMods[] = []
  if (sectId !== null) {
    for (const def of sectDef(sectId)?.skills ?? []) {
      const lv = intIn(skills[def.id], 0, SECT_SKILL_MAX_LEVEL)
      if (lv > 0) sources.push(def.mods(lv))
    }
  }
  for (const def of SECT_BUILDINGS) {
    const lv = intIn(buildings[def.id], 0, def.maxLevel)
    if (lv > 0) sources.push(def.mods(lv))
  }
  return mergeMods(sources)
}

/* ---------------- 计时结算 ---------------- */

/**
 * 到点就完工:把 build 落到 buildings 上并清空。**用服务端时钟**调用(routes/sect.ts),
 * 客户端的倒计时只用于显示,不参与结算。
 * 返回完工的建筑 id(没完工 → null),不修改入参。
 */
export function settleBuild(state: SectState, now: number): { state: SectState; done: SectBuildingId | null } {
  const task = state.build
  if (task === null) return { state, done: null }
  if (!isNum(now) || now < task.finishAt) return { state, done: null }
  const def = sectBuildingDef(task.id)
  if (def === undefined) return { state: { ...state, build: null }, done: null }
  // 目标等级不该越过上限:坏行只清任务,不白送等级
  const cap = buildingLevelCap(task.id, state.buildings.hall ?? 0)
  const to = Math.min(task.to, cap, def.maxLevel)
  const cur = intIn(state.buildings[task.id], 0, def.maxLevel)
  const next = Math.max(cur, to)
  return {
    state: { ...state, buildings: { ...state.buildings, [task.id]: next }, build: null },
    done: task.id
  }
}

/* ---------------- 修形 ---------------- */

/**
 * 状态修形。服务端每次读表都过一遍(表里的数据只有本服务写,但迁移/手工改库/回档都可能留下坏行);
 * 客户端拿到响应也过一遍 —— 两处同一份判据,不做第二套。
 *
 * 收口的东西:
 *  · 认不出的宗门/技能/建筑一律丢弃(技能还须属于该宗门,跨宗门的技能不认);
 *  · 贡献取整并夹到 [0, SECT_POINT_MAX];
 *  · 建筑等级按山门闸门与自身满级夹;
 *  · 营造任务的 `to` 只能是「当前等级 + 1」,时长不得超出该级合法耗时 —— 坏行直接清空,
 *    不修正成「还能顺手完工一次」;
 *  · 完成时刻已经过去的任务,交给 settleBuild(它按 now 判),这里只保证形状合法。
 */
export function normalizeSectState(raw: unknown, now = Date.now()): SectState {
  const src = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const sectId = typeof src.sectId === 'string' && sectDef(src.sectId) !== undefined ? (src.sectId as SectId) : null
  const out = emptySectState()
  out.sectId = sectId
  out.name = sectNameOk(src.name) ? src.name.trim() : ''
  out.personal = intIn(src.personal, 0, SECT_POINT_MAX)
  out.pool = intIn(src.pool, 0, SECT_POINT_MAX)
  out.totalDonated = intIn(src.totalDonated, 0, SECT_POINT_MAX)
  out.day = typeof src.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(src.day) ? src.day : ''
  out.donationsToday = intIn(src.donationsToday, 0, 10_000)

  if (sectId !== null) {
    const rawSkills = typeof src.skills === 'object' && src.skills !== null ? (src.skills as Record<string, unknown>) : {}
    for (const def of sectDef(sectId)?.skills ?? []) {
      const lv = intIn(rawSkills[def.id], 0, SECT_SKILL_MAX_LEVEL)
      if (lv > 0) out.skills[def.id] = lv
    }
  }

  const rawBuildings =
    typeof src.buildings === 'object' && src.buildings !== null ? (src.buildings as Record<string, unknown>) : {}
  // 先落山门,再用它算其余建筑的闸门(顺序不能反)
  const hall = intIn(rawBuildings.hall, 0, 8)
  out.buildings.hall = Math.min(hall, sectBuildingDef('hall')?.maxLevel ?? 8)
  for (const def of SECT_BUILDINGS) {
    if (def.id === 'hall') continue
    const cap = buildingLevelCap(def.id, out.buildings.hall ?? 0)
    const lv = intIn(rawBuildings[def.id], 0, def.maxLevel)
    out.buildings[def.id] = Math.min(lv, cap)
  }

  const rawBuild = typeof src.build === 'object' && src.build !== null ? (src.build as Record<string, unknown>) : null
  if (rawBuild !== null) {
    const id = typeof rawBuild.id === 'string' ? rawBuild.id : ''
    const def = sectBuildingDef(id)
    if (def !== undefined) {
      const cur = intIn(out.buildings[def.id], 0, def.maxLevel)
      const to = intIn(rawBuild.to, 0, def.maxLevel)
      const startAt = intIn(rawBuild.startAt, 0, Number.MAX_SAFE_INTEGER)
      const finishAt = intIn(rawBuild.finishAt, 0, Number.MAX_SAFE_INTEGER)
      const duration = buildingDurationMs(def.id, cur)
      /*
       * 目标必须正是「下一级」;工期给一个宽容带而不是等号:价目表调过一次(balance 改基数)
       * 之后,旧行就与当前表对不上了 —— 等号会把在造的工程一并作废。带子取 0.5~2 倍,
       * 只拦「把工期写成几毫秒」这类明显伪造;真正的写入口是服务端,这条是防手工改库的兜底。
       */
      const delta = finishAt - startAt
      const ok =
        to === cur + 1 &&
        startAt > 0 &&
        duration !== null &&
        delta >= duration * 0.5 &&
        delta <= duration * 2 + 60_000 &&
        startAt <= now + 60_000
      if (ok) out.build = { id: def.id, to, startAt, finishAt }
    }
  }
  return out
}
