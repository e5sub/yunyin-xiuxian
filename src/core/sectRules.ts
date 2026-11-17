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
  SECT_BUILDINGS,
  SECT_APPLY_MAX,
  SECT_BUILD_QUEUE_STEPS,
  SECT_BUILD_QUEUE_STEP,
  SECT_BUILDING_GATE_MULT,
  SECT_DONATIONS,
  SECT_DONATE_DAILY_CAP,
  SECT_DONATE_VIP_CAP,
  SECT_FOUND_COST,
  SECT_ELDER_MAX,
  SECT_DEPUTY_MAX,
  SECT_FOUND_MAJOR,
  SECT_HALL_SKILL_CUT,
  SECT_HALL_SKILL_CUT_MAX,
  SECT_HALL_TIME_CUT,
  SECT_HALL_TIME_CUT_MAX,
  SECT_JOIN_MAJOR,
  SECT_LEVEL_HARD_MAX,
  SECT_MEMBERS_BASE,
  SECT_MEMBERS_PER_LEVEL,
  SECT_NAME_MAX,
  SECT_NAME_MIN,
  SECT_POOL_SHARE,
  SECT_SKILLS,
  SECT_SKILL_CAP_HALL_STEP,
  SECT_SKILL_CAP_STEP,
  SECT_SKILL_CAP_STEPS,
  SECT_SKILL_COST_BASE,
  SECT_SKILL_COST_GROWTH,
  SECT_SKILL_COST_TAIL_GROWTH,
  SECT_SKILL_LEVEL_HARD_MAX,
  SECT_SKILL_MAX_LEVEL,
  SECT_ART_MAX_LEVEL,
  SECT_ARTS,
  sectArtDef,
  sectBuildingDef,
  sectSkillDef,
  type SectBuildingId
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
 * 我在门中的身份(1.71.0 起四级):
 *   掌门   —— 审批、逐人、任职罢免、解散;离开只有两条路(解散,或删档传位);
 *   副掌门 —— 审批、逐人(掌门与副掌门除外),每门一位;
 *   长老   —— 审批,每门至多四位;
   *   门人   —— 捐献、修习、自行退出(营造须有职者)。
   */
export type SectRole = 'leader' | 'deputy' | 'elder' | 'member'

/**
 * 门派状态。`day`/`donationsToday` 是服务端按 UTC+8 日界维护的捐献限次,
 * 客户端仅用于显示「今日还剩几次」。
 *
 * 一个玩家看到的这份形状 = 「门派本体的公共账」+「我自己的个人账」:
 * 服务端把 sects 里的 pool/skills/buildings/build 与 sect_members 里的
 * personal/day/donationsToday/totalDonated 拼成一份下发,客户端不必知道分了几张表。
 */
export interface SectState {
  /**
   * 门派名:玩家自取,二字至七字。**也是「有没有门派」的唯一凭据** ——
   * 建派才写名,退门/逐出/解散即清空(1.69.0 起门派不再分道统,原有 sectId 字段已废)。
   */
  name: string
  /** 个人贡献:学技能用(只属于我,退出即清零) */
  personal: number
  /** 门派库:升建筑用(全门共用) */
  pool: number
  /** 技能 id → 等级(1~30;上限由山门定,见 skillLevelCap) */
  skills: Record<string, number>
  /** 门派绝学(1.74.1):有职者出门派库研究,全门同享;id → 重数(0~SECT_ART_MAX_LEVEL) */
  arts: Record<string, number>
  /** 建筑 id → 等级(0~上限) */
  buildings: Record<string, number>
  /**
   * 营造中的工程队列(1.72.0 起可多座并行):山门 20/40/60/80 级各再开一位,
   * 容量见 buildQueueCap;空数组表示空闲。旧档的单座对象在 normalize 里收进数组。
   */
  build: SectBuildTask[]
  /** 捐献日号 YYYY-MM-DD(UTC+8) */
  day: string
  donationsToday: number
  /** 累计捐献贡献(展示用,不影响数值) */
  totalDonated: number
  /** 我的身份;未入门派 → null */
  role: SectRole | null
  /** 门中现有几人(含掌门);由服务端按成员表实算,客户端只显示 */
  memberCount: number
}

export function emptySectState(): SectState {
  return {
    name: '',
    personal: 0,
    pool: 0,
    skills: {},
    arts: {},
    buildings: {},
    build: [],
    day: '',
    donationsToday: 0,
    totalDonated: 0,
    role: null,
    memberCount: 0
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

/** 到没到开宗立派的境界(元婴起) */
export function canFound(major: number): boolean {
  return Number.isFinite(major) && major >= SECT_FOUND_MAJOR
}

/**
 * 够不够投师的境界(筑基起)。比开派低两个大境界 ——
 * 前期玩家开不起派,但可以入一家的门借道统修行。
 */
export function canJoin(major: number): boolean {
  return Number.isFinite(major) && major >= SECT_JOIN_MAJOR
}

/**
 * 每日捐献次数上限:常驻 3 次,VIP 5 次。
 * 客户端显示「今日还剩几次」与服务端限次同源 —— 两处各写一个 5 迟早对不上。
 */
export function donationQuota(vip = false): number {
  return vip ? SECT_DONATE_VIP_CAP : SECT_DONATE_DAILY_CAP
}

/** 门人上限:山门定员,初始 10 人,山门每升一级 +1 人(山门不封顶,名额也就不封顶) */
export function memberCap(hallLevel: number): number {
  return SECT_MEMBERS_BASE + intIn(hallLevel, 0, SECT_LEVEL_HARD_MAX) * SECT_MEMBERS_PER_LEVEL
}

/** 一家门派能同时挂着几份待审申请(服务端审批前按它挡刷申请;客户端不显示这个数) */
export function applyCap(): number {
  return SECT_APPLY_MAX
}

/** 营造队列容量:初始一位,山门 20/40/60/80 级各再开一位(至多五位) */
export function buildQueueCap(hallLevel: number): number {
  const hall = intIn(hallLevel, 0, SECT_LEVEL_HARD_MAX)
  let cap = 1
  for (let i = 1; i <= SECT_BUILD_QUEUE_STEPS; i++) {
    if (hall >= i * SECT_BUILD_QUEUE_STEP) cap++
  }
  return cap
}

/* ---------------- 职位(1.71.0) ---------------- */

/** 全部合法身份(与 normalizeSectState / 服务端成员表同源) */
const SECT_ROLES: readonly SectRole[] = ['leader', 'deputy', 'elder', 'member']

/** 名额表:副掌门一位、长老四位;掌门与门人不走这张表(掌门唯一靠 leader_uid,门人随山门) */
export function roleCap(role: SectRole): number | null {
  if (role === 'deputy') return SECT_DEPUTY_MAX
  if (role === 'elder') return SECT_ELDER_MAX
  return null
}

/** 能不能审批申请:副掌门与长老替掌门分担,门人不能 */
export function canReviewSect(role: SectRole | null): boolean {
  return role === 'leader' || role === 'deputy' || role === 'elder'
}

/** 能不能操持营造(开工与收取):有职者为之,门人只捐贡献不掌工程 */
export function canBuildSect(role: SectRole | null): boolean {
  return role === 'leader' || role === 'deputy' || role === 'elder'
}

/**
 * 能不能逐人。掌门可逐除自己外任何人;副掌门可逐长老与门人;长老与门人不能逐人。
 * 目标与发起者是同一人时一律 false(想走请走退门,贡献清零那条路)。
 */
export function canKickSect(actor: SectRole, target: SectRole): boolean {
  if (actor === 'leader') return target !== 'leader'
  if (actor === 'deputy') return target === 'elder' || target === 'member'
  return false
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

/**
 * 山门照拂之一:技能所耗个人贡献的系数(1 = 不打折)。
 * 每级 -0.5%,封顶 -50%(百级)—— 山门愈高,门中传功愈省。
 */
export function hallSkillRate(hallLevel: number): number {
  const hall = intIn(hallLevel, 0, SECT_LEVEL_HARD_MAX)
  return 1 - Math.min(SECT_HALL_SKILL_CUT_MAX, hall * SECT_HALL_SKILL_CUT)
}

/**
 * 山门照拂之二:营造工期的系数(1 = 不打折)。
 * 每级 -1%,封顶 -60%(百级)—— 山门愈高,营造愈快,但仍要等。
 */
export function hallTimeRate(hallLevel: number): number {
  const hall = intIn(hallLevel, 0, SECT_LEVEL_HARD_MAX)
  return 1 - Math.min(SECT_HALL_TIME_CUT_MAX, hall * SECT_HALL_TIME_CUT)
}

/**
 * 技能的等级上限:基础五重,山门每 20 级再开五重(20/40/60/80/100 级各一次,封顶三十重)。
 * 与建筑闸门同一思路 —— 主建筑定余地,只是这里定的是「能练到第几重」。
 */
export function skillLevelCap(hallLevel: number): number {
  const hall = intIn(hallLevel, 0, SECT_LEVEL_HARD_MAX)
  const steps = Math.min(SECT_SKILL_CAP_STEPS, Math.floor(hall / SECT_SKILL_CAP_HALL_STEP))
  return SECT_SKILL_MAX_LEVEL + steps * SECT_SKILL_CAP_STEP
}

/** 再开一重的山门等级;已到最后一档 → null(界面用它写「山门 N 级可续修」) */
export function skillCapNextHall(hallLevel: number): number | null {
  const hall = intIn(hallLevel, 0, SECT_LEVEL_HARD_MAX)
  const steps = Math.floor(hall / SECT_SKILL_CAP_HALL_STEP)
  if (steps >= SECT_SKILL_CAP_STEPS) return null
  return (steps + 1) * SECT_SKILL_CAP_HALL_STEP
}

/** 某门技能从 level 升到 level+1 的个人贡献价;满级/认不出 → null */
export function skillCost(skillId: string, level: number, rate = 1, hallLevel = 0): number | null {
  const def = sectSkillDef(skillId)
  if (def === undefined) return null
  const cap = skillLevelCap(hallLevel)
  const lv = intIn(level, 0, SECT_SKILL_LEVEL_HARD_MAX)
  if (lv >= cap) return null
  const base = SECT_SKILL_COST_BASE[Math.min(def.row, SECT_SKILL_COST_BASE.length) - 1] ?? SECT_SKILL_COST_BASE[0]
  /*
   * 分段价目:前五重按 1.9 陡涨(与旧版逐分相同,不改既有手感),
   * 五重之后转 1.15 缓涨(理由见 SECT_SKILL_COST_TAIL_GROWTH)。
   * head/tail 拆开而不是一路乘:换斜率的那一重不该再吃一次 1.9。
   */
  const head = Math.min(lv, SECT_SKILL_MAX_LEVEL - 1)
  const tail = Math.max(0, lv - (SECT_SKILL_MAX_LEVEL - 1))
  const cost =
    base * Math.pow(SECT_SKILL_COST_GROWTH, head) * Math.pow(SECT_SKILL_COST_TAIL_GROWTH, tail)
  // 两个系数各管一头:VIP 九折是「人」的优待,山门减免是「门」的优待,相乘而不是取其一
  return Math.ceil(cost * priceRate(rate) * hallSkillRate(hallLevel))
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
 * 同层解锁:第 n 层(n ≥ 2)须先在本门把第 n-1 层的**任意一门**练到二重。
 * 第 1 层无条件。返回上一层三门的 id(第 1 层 → 空表)。
 *
 * 三脉合一之后没有「本宗门的上一层」这一说 —— 上一层三脉任修一门即算入门,
 * 于是「先修太虚剑意、再转万象阵理」这种混修是可行的,专精与兼修自己权衡。
 */
export function skillPrevRow(skillId: string): string[] {
  const def = sectSkillDef(skillId)
  if (def === undefined || def.row <= 1) return []
  return SECT_SKILLS.filter(s => s.row === def.row - 1).map(s => s.id)
}

/** 某门技能现在能不能修(上一层已有一门到二重) */
export function skillUnlocked(skills: Record<string, number>, skillId: string): boolean {
  const prev = skillPrevRow(skillId)
  if (prev.length === 0) return true
  return prev.some(id => (skills[id] ?? 0) >= 2)
}

/**
 * 建筑从 level 升到 level+1 的门派贡献价 —— **没有满级**,只有认不出的 id 才回 null。
 *
 * 曲线 `costBase × (lv+1)^1.15 × 1.04^lv`:幂律管前段手感(山门 1 级 60、10 级约 1200),
 * 缓增的几何项管后段(20 级约 4000、50 级约 3.7 万、100 级约 58 万)。
 * 对照门派库的来路:单人每日三捐入 540,十人同捐 5400 ——
 * 二十级前一人一日可升一两级,五十级要全门攒上一周,百级就是长线经营了。
 * 不设天花板,但也不会有「一夜垒到百级」这种曲线。
 */
export function buildingCost(id: string, level: number, rate = 1): number | null {
  const def = sectBuildingDef(id)
  if (def === undefined) return null
  const lv = intIn(level, 0, SECT_LEVEL_HARD_MAX)
  return Math.ceil(def.costBase * Math.pow(lv + 1, 1.15) * Math.pow(1.04, lv) * priceRate(rate))
}

/**
 * 建筑从 level 升到 level+1 的等待时长(毫秒)—— 同样没有满级。
 * 曲线 `timeBaseMin × (lv+1)^0.75`:1 级六分钟,10 级约半小时,50 级约两小时,100 级约三小时。
 * 时间只随等级缓涨而不指数爆炸 —— 否则高等级一升就是等几天,经营感会变成罚站。
 */
export function buildingDurationMs(id: string, level: number, hallLevel = 0): number | null {
  const def = sectBuildingDef(id)
  if (def === undefined) return null
  const lv = intIn(level, 0, SECT_LEVEL_HARD_MAX)
  return Math.ceil(def.timeBaseMin * 60_000 * Math.pow(lv + 1, 0.75) * hallTimeRate(hallLevel))
}

/**
 * 建筑等级上限:山门本身无上限(只受硬夹),其余 = (山门等级 + 1) × 2。
 * 山门是闸门 —— 副建筑想再往上,先垫山门一级;山门不封顶,这份余地也就一直有得开。
 * 与洞府(gongfaSeats 那套)都是「主闸限副」,区别是门派没有品类满级。
 */
export function buildingLevelCap(id: string, hallLevel: number): number {
  const def = sectBuildingDef(id)
  if (def === undefined) return 0
  if (def.id === 'hall') return SECT_LEVEL_HARD_MAX
  return Math.min(SECT_LEVEL_HARD_MAX, (intIn(hallLevel, 0, SECT_LEVEL_HARD_MAX) + 1) * SECT_BUILDING_GATE_MULT)
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

/** 门派给的属性:十五门技能各按现值 + 建筑各按现值,合成一份(与洞府 buildingMods 同规) */
export function sectMods(skills: Record<string, number>, buildings: Record<string, number>, arts: Record<string, number> = {}): StatMods {
  const sources: StatMods[] = []
  // 技能等级按山门定的上限夹:与 skillCost 同一把尺,少了这一道就凭坏数多算几重
  const cap = skillLevelCap(intIn(buildings.hall, 0, SECT_LEVEL_HARD_MAX))
  for (const def of SECT_SKILLS) {
    const lv = intIn(skills[def.id], 0, cap)
    if (lv > 0) sources.push(def.mods(lv))
  }
  for (const def of SECT_BUILDINGS) {
    const lv = intIn(buildings[def.id], 0, SECT_LEVEL_HARD_MAX)
    if (lv > 0) sources.push(def.mods(lv))
  }
  // 门派绝学(1.74.1):研究成即全门生效,重数按上限夹,只认 normalize 过的真 id
  for (const def of SECT_ARTS) {
    const lv = intIn(arts[def.id], 0, SECT_ART_MAX_LEVEL)
    if (lv > 0) sources.push(def.mods(lv))
  }
  return mergeMods(sources)
}

/* ---------------- 门派绝学 ---------------- */

/**
 * 绝学升到 toLevel 重所需的山派库价(1.74.1 运营定则):
 *  · 从门派库扣,不走个人贡献;
 *  · **不吃 VIP 折扣** —— 这是门派的公账,不是「人」的修行开销;
 *  · **吃山门减免** —— 与修习同读 hallSkillRate(每级 -0.5%,百级 -50%);
 *  · 每升一重 ×1.9(与技能前五重同一条陡峭曲线):等级越高,贡献消耗越高。
 * toLevel 从 1 起;认不出这门绝学或 toLevel 越界返回 null。
 */
/** 绝学重数上限(服务端经 vendor 同读这一把尺) */
export function artMaxLevel(): number {
  return SECT_ART_MAX_LEVEL
}

export function artCost(id: string, toLevel: number, hallLevel = 0): number | null {
  const def = sectArtDef(id)
  if (def === undefined) return null
  const to = Math.trunc(toLevel)
  // 越界重数不签:夹到界内会把「研第六重」的请求悄悄按第五重收钱,宁拒勿错
  if (!Number.isFinite(to) || to < 1 || to > SECT_ART_MAX_LEVEL) return null
  return Math.max(1, Math.round(def.costPool * Math.pow(1.9, to - 1) * hallSkillRate(hallLevel)))
}

/* ---------------- 计时结算 ---------------- */

/**
 * 到点就完工:队列里所有过了 finishAt 的工程逐一落级,未到点的留在队列里。
 * **用服务端时钟**调用(routes/sect.ts),客户端的倒计时只用于显示,不参与结算。
 * 返回完工的建筑 id 列表(没完工 → 空表),不修改入参。
 * 山门先落级会抬高后续任务的闸门 —— 按落级后的 buildings 逐个算上限。
 */
export function settleBuild(state: SectState, now: number): { state: SectState; done: SectBuildingId[] } {
  if (!isNum(now) || state.build.length === 0) return { state, done: [] }
  const buildings = { ...state.buildings }
  const rest: SectBuildTask[] = []
  const done: SectBuildingId[] = []
  for (const task of state.build) {
    if (now < task.finishAt) {
      rest.push(task)
      continue
    }
    // 目标等级不该越过上限:坏行只清任务,不白送等级(山门无上限,闸门只管副建筑)
    const cap = buildingLevelCap(task.id, buildings.hall ?? 0)
    const to = Math.min(task.to, cap)
    const cur = intIn(buildings[task.id], 0, SECT_LEVEL_HARD_MAX)
    buildings[task.id] = Math.max(cur, to)
    done.push(task.id)
  }
  if (done.length === 0) return { state, done }
  return { state: { ...state, buildings, build: rest }, done }
}

/* ---------------- 修形 ---------------- */

/**
 * 状态修形。服务端每次读表都过一遍(表里的数据只有本服务写,但迁移/手工改库/回档都可能留下坏行);
 * 客户端拿到响应也过一遍 —— 两处同一份判据,不做第二套。
 *
 * 收口的东西:
 *  · 门派名合法即视为已立派(名字是唯一凭据);名字坏掉 → 整份按未立派处理;
 *  · 认不出的技能/建筑一律丢弃(技能只认三脉十五门那几门);
 *  · 贡献取整并夹到 [0, SECT_POINT_MAX];
 *  · 建筑等级按山门闸门夹(山门自身只受硬夹 —— 门派建筑没有品类满级);
 *  · 技能等级按山门开的档位夹(五重起,山门每 20 级再开五重,至多三十重);
 *  · 营造任务的 `to` 只能是「当前等级 + 1」,时长不得超出该级合法耗时 —— 坏行直接清空,
 *    不修正成「还能顺手完工一次」;
 *  · 完成时刻已经过去的任务,交给 settleBuild(它按 now 判),这里只保证形状合法。
 */
export function normalizeSectState(raw: unknown, now = Date.now()): SectState {
  const src = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const out = emptySectState()
  out.name = sectNameOk(src.name) ? src.name.trim() : ''
  const founded = out.name !== ''
  out.personal = intIn(src.personal, 0, SECT_POINT_MAX)
  out.pool = intIn(src.pool, 0, SECT_POINT_MAX)
  out.totalDonated = intIn(src.totalDonated, 0, SECT_POINT_MAX)
  out.day = typeof src.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(src.day) ? src.day : ''
  out.donationsToday = intIn(src.donationsToday, 0, 10_000)
  /*
   * 身份与门人数只认服务端下发的形状:没门派的角色一律空。
   * 门人数按 [0, 5000] 夹 —— 上界只防坏数把面板撑破(山门不封顶,名额也不封顶)。
   */
  out.role = founded && (SECT_ROLES as readonly unknown[]).includes(src.role) ? (src.role as SectRole) : null
  out.memberCount = founded ? intIn(src.memberCount, 0, 5000) : 0

  /*
   * 未立派就没有建筑、工程与技能可谈:名字坏了整份归零,别留下一座无人认领的空门。
   * **建筑先落、技能后落**:技能上限由山门定(见 skillLevelCap),顺序反了就会按未落地的山门算上限。
   */
  if (founded) {
    const rawBuildings =
      typeof src.buildings === 'object' && src.buildings !== null ? (src.buildings as Record<string, unknown>) : {}
    // 先落山门,再用它算其余建筑的闸门(顺序不能反)。山门无上限,只受硬夹。
    out.buildings.hall = intIn(rawBuildings.hall, 0, SECT_LEVEL_HARD_MAX)
    for (const def of SECT_BUILDINGS) {
      if (def.id === 'hall') continue
      const cap = buildingLevelCap(def.id, out.buildings.hall ?? 0)
      out.buildings[def.id] = intIn(rawBuildings[def.id], 0, cap)
    }

    const rawSkills = typeof src.skills === 'object' && src.skills !== null ? (src.skills as Record<string, unknown>) : {}
    const skillCap = skillLevelCap(out.buildings.hall ?? 0)
    for (const def of SECT_SKILLS) {
      const lv = intIn(rawSkills[def.id], 0, skillCap)
      if (lv > 0) out.skills[def.id] = lv
    }

    // 门派绝学(1.74.1):只认真有这门绝学的条目,野 id 与坏值一律不入账;重数按上限夹
    const rawArts = typeof src.arts === 'object' && src.arts !== null ? (src.arts as Record<string, unknown>) : {}
    for (const def of SECT_ARTS) {
      const lv = intIn(rawArts[def.id], 0, SECT_ART_MAX_LEVEL)
      if (lv > 0) out.arts[def.id] = lv
    }

    /*
     * 营造队列(1.72.0 起多座并行):旧档的单座对象包成一项收进来,坏项直接丢。
     * 容量按山门算(buildQueueCap);同座两份在造只留先来的一份 —— 一座建筑不能同时往两处升。
     */
    const rawBuildList: unknown[] = Array.isArray(src.build)
      ? src.build
      : src.build !== null && typeof src.build === 'object'
        ? [src.build]
        : []
    const queueCap = buildQueueCap(out.buildings.hall ?? 0)
    const queued = new Set<string>()
    for (const item of rawBuildList) {
      if (out.build.length >= queueCap) break
      if (typeof item !== 'object' || item === null || Array.isArray(item)) continue
      const rawBuild = item as Record<string, unknown>
      const id = typeof rawBuild.id === 'string' ? rawBuild.id : ''
      const def = sectBuildingDef(id)
      if (def === undefined || queued.has(def.id)) continue
      const cur = intIn(out.buildings[def.id], 0, SECT_LEVEL_HARD_MAX)
      const to = intIn(rawBuild.to, 0, SECT_LEVEL_HARD_MAX)
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
      if (ok) {
        out.build.push({ id: def.id, to, startAt, finishAt })
        queued.add(def.id)
      }
    }
  }
  return out
}
