/**
 * 门派状态(1.68.0,1.69.0 起为多人门派)—— **不进存档分片,也不持久化**。
 *
 * 整份状态的唯一真身在服务端(server/src/sectState.ts):贡献是签发货币,技能与建筑给永久属性,
 * 放进存档就等于「本地可写」。所以这里只做三件事:
 *   1. 把服务端返回的状态存成一份只读拷贝(加载/动作后刷新);
 *   2. 按共用规则(core/sectRules)算属性与价签 —— 与服务端同一份函数,不另写一套;
 *   3. 动作成功后按**服务端回传的实扣**扣本地资源(建派/捐献),其余数值以回传状态为准。
 *
 * 未登录时不会有门派:本服是网游版,路由守卫要求登录,客户端不必准备离线分支。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  cloudApi,
  type SectApplyView,
  type SectBriefView,
  type SectMemberView,
  type SectStateResp
} from '@/services/cloud'
import { useAuthStore } from '@/stores/auth'
import { useResourcesStore } from '@/stores/resources'
import { useUiStore } from '@/stores/ui'
import { gn } from '@/utils/gnum'
import { VIP_SPEND_RATE } from '@/core/spendRate'
import type { SectBuildingId, SectDonateKind } from '@/data/sect'
import type { HerbGrade } from '@/data/herbGrades'
import {
  buildingLevelCap,
  canBuildSect,
  canKickSect,
  canReviewSect,
  buildQueueCap,
  donationQuota,
  emptySectState,
  memberCap,
  normalizeSectState,
  sectMods,
  skillLevelCap,
  type SectRole,
  type SectState
} from '@/core/sectRules'

/** 拒因 → 一句人话(服务端只回状态词,不缀礼貌话) */
const REASON_TEXT: Record<string, string> = {
  nosect: '尚未入得门派',
  exists: '已在门派之中',
  realm: '境界不足',
  badname: '门派名须二至七字',
  nameused: '此名已有门派取了',
  insufficient: '所捐之物不足',
  daily: '今日捐献已尽',
  busy: '营造队列已满或此座已在造',
  cap: '山门未及,先垫山门',
  pool: '门派库不足',
  personal: '个人贡献不足',
  locked: '上一层尚未练到二重',
  /** 技能到顶:不是「练满」,而是山门还没垒到那一档 */
  skillcap: '山门未及此重',
  /** 绝学到顶:五重圆满 */
  artcap: '此门绝学已臻圆满',
  gone: '查无此物',
  joined: '此人已入他门',
  notdone: '工程未竟',
  /** 营造须有职者(掌门/副掌门/长老),门人不开工 */
  notauth: '此事须有职者为之',
  full: '门人已满,先升山门',
  fullapply: '门外候着的人太多',
  notleader: '此事须掌门定夺',
  /** 任职名额满了:副掌门一位、长老四位 */
  fullrole: '此职已有人担任',
  isleader: '掌门须先解散门派',
  nosave: '云端还没有存档',
  retry: '门派有变 · 再试一次',
  error: '未能结算'
}

/** UTC+8 日号:与 service 的 dayKeyOf 同一把尺,只用于「今日还剩几次」的显示 */
function dayKeyNow(now = Date.now()): string {
  return new Date(now + 8 * 3_600_000).toISOString().slice(0, 10)
}

/** 职位名(界面文案;与服务端成员表的四个枚举值一一对应) */
const ROLE_LABEL: Record<SectRole, string> = { leader: '掌门', deputy: '副掌门', elder: '长老', member: '门人' }

export const useSectStore = defineStore('sect', () => {
  const state = ref<SectState>(emptySectState())
  /**
   * 门册只取一页:山门不封顶,门人可能上百,整本读进来既费流量也没处放。
   * 搜索词与页码留在 store 里,关掉弹窗再开还是刚才那一页。
   */
  const memberRows = ref<SectMemberView[]>([])
  const memberTotal = ref(0)
  const memberPage = ref(1)
  const memberPageSize = ref(12)
  const memberQuery = ref('')
  /** 门册请求在途(翻页/搜索时界面据此禁用,防连点把页码打乱) */
  const membersPending = ref(false)
  /** 门外候着的申请(只有掌门拿得到) */
  const applies = ref<SectApplyView[]>([])
  /** 我挂着的申请(未入派时) */
  const appliedTo = ref<{ id: number; name: string } | null>(null)
  /** 可投师的门派(未入派时) */
  const sectList = ref<SectBriefView[]>([])
  const loaded = ref(false)
  /** 服务端时刻与本机的差:倒计时用它,不拿本机时钟直接减服务端时间 */
  const skew = ref(0)
  /** 正在发请求(界面据此禁用按钮,防连点) */
  const pending = ref(false)

  /** 价签用的折扣系数:VIP 有效期内九折(与服务端 vipActive 同值,只作预览) */
  const rate = computed(() => (useAuthStore().isVip ? VIP_SPEND_RATE : 1))
  /** 有门派:门派名是唯一凭据(建派才写名) */
  const founded = computed(() => state.value.name !== '')
  const isLeader = computed(() => state.value.role === 'leader')
  /** 我的职位名(门派页徽标与门册页首共用;未入门 → 空串) */
  const roleLabel = computed(() => (state.value.role === null ? '' : ROLE_LABEL[state.value.role]))
  /** 有审批权:掌门、副掌门、长老(候批页签与红点跟它走) */
  const canReview = computed(() => canReviewSect(state.value.role))
  /** 我能不能逐掉某个身份的门人(与 /sect/kick 的授权矩阵同源) */
  const canKick = (targetRole: SectRole): boolean =>
    state.value.role !== null && canKickSect(state.value.role, targetRole)
  /** 能不能操持营造(开工与收取):掌门/副掌门/长老(与 /sect/build 的判权同源) */
  const canBuild = computed(() => canBuildSect(state.value.role))
  /** 营造队列容量:山门 20/40/60/80 级各再开一位(初始一位) */
  const queueCap = computed(() => buildQueueCap(state.value.buildings.hall ?? 0))
  const name = computed(() => state.value.name)
  const personal = computed(() => state.value.personal)
  const pool = computed(() => state.value.pool)
  /** 门派给的属性:三脉十五门技能 + 五座建筑 + 五门绝学,与洞府 buildingMods 同一套写法 */
  const mods = computed(() => sectMods(state.value.skills, state.value.buildings, state.value.arts))
  const skillLevel = (id: string): number => state.value.skills[id] ?? 0
  const buildingLevel = (id: SectBuildingId): number => state.value.buildings[id] ?? 0
  /** 建筑可达上限(山门闸门;山门自身无上限) */
  const levelCap = (id: SectBuildingId): number => buildingLevelCap(id, state.value.buildings.hall ?? 0)
  /** 今日还可捐几次:常驻 3、VIP 5(与服务端 rules.donationQuota 同源) */
  const donationsLeft = computed(() => {
    const quota = donationQuota(useAuthStore().isVip)
    return state.value.day === dayKeyNow() ? Math.max(0, quota - state.value.donationsToday) : quota
  })
  /** 现有门人(含掌门,服务端实算) */
  const memberCount = computed(() => state.value.memberCount)
  /** 门人上限:山门定员(初始 10,每级 +1;山门不封顶) */
  const capacity = computed(() => memberCap(state.value.buildings.hall ?? 0))
  /** 技能等级上限:基础五重,山门每 20 级再开五重(与服务端 skillLevelCap 同源) */
  const skillCap = computed(() => skillLevelCap(state.value.buildings.hall ?? 0))
  /** 门册共几页(搜索之后按命中数算) */
  const memberPages = computed(() => Math.max(1, Math.ceil(memberTotal.value / memberPageSize.value)))
  /** 门外候着几份申请(掌门才拿得到) */
  const applyCount = computed(() => applies.value.length)

  /** 服务端此刻(毫秒) */
  function serverNow(): number {
    return Date.now() + skew.value
  }

  /** 最近一座完工还剩多久(毫秒);队列空 → 0(界面逐卡倒计时,这里只作汇总口径) */
  function remainingMs(): number {
    let min = 0
    for (const task of state.value.build) {
      const left = Math.max(0, task.finishAt - serverNow())
      if (min === 0 || left < min) min = left
    }
    return min
  }

  /** 把一份响应收进本地:状态、门人、申请、时钟一并刷新;ok=false 时只报原因 */
  function absorb(res: SectStateResp): boolean {
    skew.value = Number.isFinite(res.now) ? res.now - Date.now() : 0
    loaded.value = true
    if (!res.ok) {
      useUiStore().toast(REASON_TEXT[res.reason ?? 'error'] ?? '未能结算', 'warn')
      return false
    }
    state.value = res.state
    applies.value = res.applies ?? []
    appliedTo.value = res.appliedTo ?? null
    sectList.value = res.list ?? []
    return true
  }

  /**
   * 无头水合:只把一份状态收进来,不发请求、不动时钟。
   * 门派不在存档分片里,服务端复算档案快照(core/profileRecompute)要算门派加成,
   * 只能由它自己读表后从这条口子注进来 —— 两边同一份 normalizeSectState,不另立口径。
   */
  function hydrate(raw: unknown): void {
    state.value = normalizeSectState(raw, Date.now())
  }

  /** 读门派;首次进入门派页与登录后各调一次。失败不抛(界面显示「未能读取」) */
  async function load(): Promise<boolean> {
    try {
      return absorb(await cloudApi.sectState())
    } catch {
      return false
    }
  }

  /**
   * 读一页门册(带搜索词)。与 load 分开:门册只在弹窗里用得上,
   * 不必每次读门派都顺带拉一遍;动作之后弹窗自己重取,不必服务端在每个动作里塞全表。
   */
  async function loadMembers(q = memberQuery.value, page = memberPage.value): Promise<boolean> {
    if (membersPending.value) return false
    membersPending.value = true
    try {
      const res = await cloudApi.sectMembers(q, page)
      memberRows.value = res.members
      memberTotal.value = res.total
      memberPage.value = res.page
      memberPageSize.value = res.pageSize
      memberQuery.value = q
      return true
    } catch {
      useUiStore().toast(REASON_TEXT.error ?? '未能结算', 'warn')
      return false
    } finally {
      membersPending.value = false
    }
  }

  /** 动作外壳:防连点(请求在途时直接拒),异常按「未能结算」 */
  async function run(fn: () => Promise<SectStateResp>): Promise<SectStateResp | null> {
    if (pending.value) return null
    pending.value = true
    try {
      return await fn()
    } catch {
      useUiStore().toast(REASON_TEXT.error ?? '未能结算', 'warn')
      return null
    } finally {
      pending.value = false
    }
  }

  /** 开宗立派:成功后按回传的实扣扣本地(灵石/玄铁/悟道点) */
  async function found(sectName: string): Promise<boolean> {
    const res = await run(() => cloudApi.sectFound(sectName))
    if (res === null) return false
    if (!absorb(res)) return false
    const spend = res.spend
    if (spend !== undefined && !('kind' in spend)) {
      const resources = useResourcesStore()
      if (spend.stone !== undefined) resources.spendStone(gn(spend.stone))
      if (spend.ore !== undefined) resources.spendSmall('ore', spend.ore)
      if (spend.wudao !== undefined) resources.spendSmall('wudao', spend.wudao)
    }
    useUiStore().toast(`开宗立派 · ${sectName}`, 'rare')
    return true
  }

  /** 投师:递一份申请(等掌门批复) */
  async function join(sect: number): Promise<boolean> {
    const res = await run(() => cloudApi.sectJoin(sect))
    if (res === null) return false
    if (!absorb(res)) return false
    useUiStore().toast('申请已递上 · 静候掌门批复', 'info')
    return true
  }

  /** 撤回申请 */
  async function cancelApply(): Promise<boolean> {
    const res = await run(() => cloudApi.sectJoinCancel())
    if (res === null) return false
    return absorb(res)
  }

  /** 掌门审批:准许入册 / 谢绝 */
  async function review(user: number, approve: boolean): Promise<boolean> {
    const res = await run(() => cloudApi.sectReview(user, approve))
    if (res === null) return false
    const ok = absorb(res)
    if (ok) useUiStore().toast(approve ? '已录入门册' : '已谢绝来投', approve ? 'rare' : 'info')
    return ok
  }

  /** 逐出门人(掌门与副掌门) */
  async function kick(user: number): Promise<boolean> {
    const res = await run(() => cloudApi.sectKick(user))
    if (res === null) return false
    return absorb(res)
  }

  /** 任职罢免(仅掌门):设为副掌门/长老,或罢为门人 */
  async function setRole(user: number, role: SectRole): Promise<boolean> {
    const res = await run(() => cloudApi.sectRole(user, role))
    if (res === null) return false
    const ok = absorb(res)
    if (ok) useUiStore().toast('门中职位已定', 'info')
    return ok
  }

  /** 退出山门(门人;个人贡献随之清零) */
  async function leave(): Promise<boolean> {
    const res = await run(() => cloudApi.sectLeave())
    if (res === null) return false
    return absorb(res)
  }

  /** 解散门派(掌门) */
  async function dissolve(): Promise<boolean> {
    const res = await run(() => cloudApi.sectDissolve())
    if (res === null) return false
    return absorb(res)
  }

  /** 捐献:成功后按回传的一份实物扣本地 */
  async function donate(kind: SectDonateKind): Promise<boolean> {
    const res = await run(() => cloudApi.sectDonate(kind))
    if (res === null) return false
    if (!absorb(res)) return false
    const spend = res.spend
    if (spend !== undefined && 'kind' in spend) {
      const resources = useResourcesStore()
      if (spend.kind === 'stone') resources.spendStone(gn(spend.amount))
      else if (spend.kind === 'ore') resources.spendSmall('ore', spend.amount)
      else resources.spendHerb(spend.grade as HerbGrade, spend.amount)
    }
    return true
  }

  /** 开工营造 */
  async function startBuild(id: SectBuildingId): Promise<boolean> {
    const res = await run(() => cloudApi.sectBuildStart(id))
    if (res === null) return false
    return absorb(res)
  }

  /** 收取完工(到点才成) */
  async function claimBuild(): Promise<boolean> {
    const res = await run(() => cloudApi.sectBuildClaim())
    if (res === null) return false
    return absorb(res)
  }

  /** 修习一重 */
  async function learn(skillId: string): Promise<boolean> {
    const res = await run(() => cloudApi.sectSkillLearn(skillId))
    if (res === null) return false
    return absorb(res)
  }

  /** 研究门派绝学(1.74.1):有职者出门派库一次性付清,研究成全门同享 */
  async function researchArt(artId: string): Promise<boolean> {
    const res = await run(() => cloudApi.sectArtResearch(artId))
    if (res === null) return false
    return absorb(res)
  }

  /** 登出/切号:清空,免得下一号看见上一号的门派 */
  function reset(): void {
    state.value = emptySectState()
    memberRows.value = []
    memberTotal.value = 0
    memberPage.value = 1
    memberPageSize.value = 12
    memberQuery.value = ''
    applies.value = []
    appliedTo.value = null
    sectList.value = []
    loaded.value = false
    skew.value = 0
  }

  return {
    state,
    memberRows,
    memberTotal,
    memberPage,
    memberPageSize,
    memberPages,
    memberQuery,
    membersPending,
    applies,
    appliedTo,
    sectList,
    loaded,
    pending,
    /** 服务端与本机的时差(毫秒):倒计时用 now + offset */
    offset: skew,
    rate,
    founded,
    isLeader,
    canReview,
    canKick,
    canBuild,
    queueCap,
    roleLabel,
    name,
    personal,
    pool,
    mods,
    donationsLeft,
    memberCount,
    capacity,
    skillCap,
    applyCount,
    skillLevel,
    buildingLevel,
    levelCap,
    serverNow,
    remainingMs,
    hydrate,
    load,
    loadMembers,
    found,
    join,
    cancelApply,
    review,
    kick,
    setRole,
    leave,
    dissolve,
    donate,
    startBuild,
    claimBuild,
    learn,
    researchArt,
    reset
  }
})
