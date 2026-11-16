/**
 * 门派状态(1.68.0)—— **不进存档分片,也不持久化**。
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
import { cloudApi, type SectStateResp } from '@/services/cloud'
import { useAuthStore } from '@/stores/auth'
import { useResourcesStore } from '@/stores/resources'
import { useUiStore } from '@/stores/ui'
import { gn } from '@/utils/gnum'
import { VIP_SPEND_RATE } from '@/core/spendRate'
import type { SectBuildingId, SectDonateKind } from '@/data/sect'
import type { HerbGrade } from '@/data/herbGrades'
import {
  buildingLevelCap,
  donationQuota,
  emptySectState,
  memberCap,
  normalizeSectState,
  sectMods,
  type SectState
} from '@/core/sectRules'

/** 拒因 → 一句人话(服务端只回状态词,不缀礼貌话) */
const REASON_TEXT: Record<string, string> = {
  nosect: '尚未开宗立派',
  exists: '门派已立',
  realm: '境界不足',
  badname: '门派名须二至七字',
  insufficient: '所捐之物不足',
  daily: '今日捐献已尽',
  busy: '已有工程在造',
  cap: '已达等级上限',
  pool: '门派库不足',
  personal: '个人贡献不足',
  locked: '上一层尚未练到二重',
  gone: '查无此物',
  notdone: '工程未竟',
  nosave: '云端还没有存档',
  error: '未能结算'
}

/** UTC+8 日号:与 service 的 dayKeyOf 同一把尺,只用于「今日还剩几次」的显示 */
function dayKeyNow(now = Date.now()): string {
  return new Date(now + 8 * 3_600_000).toISOString().slice(0, 10)
}

export const useSectStore = defineStore('sect', () => {
  const state = ref<SectState>(emptySectState())
  const loaded = ref(false)
  /** 服务端时刻与本机的差:倒计时用它,不拿本机时钟直接减服务端时间 */
  const skew = ref(0)
  /** 正在发请求(界面据此禁用按钮,防连点) */
  const pending = ref(false)

  /** 价签用的折扣系数:VIP 有效期内九折(与服务端 vipActive 同值,只作预览) */
  const rate = computed(() => (useAuthStore().isVip ? VIP_SPEND_RATE : 1))
  const founded = computed(() => state.value.sectId !== null)
  const name = computed(() => state.value.name)
  const personal = computed(() => state.value.personal)
  const pool = computed(() => state.value.pool)
  /** 门派给的属性:接进 player 的来源明细,与洞府建筑同一套写法 */
  const mods = computed(() => sectMods(state.value.sectId, state.value.skills, state.value.buildings))
  const skillLevel = (id: string): number => state.value.skills[id] ?? 0
  const buildingLevel = (id: SectBuildingId): number => state.value.buildings[id] ?? 0
  /** 建筑可达上限(山门闸门) */
  const levelCap = (id: SectBuildingId): number => buildingLevelCap(id, state.value.buildings.hall ?? 0)
  /** 今日还可捐几次:常驻 3、VIP 5(与服务端 rules.donationQuota 同源) */
  const donationsLeft = computed(() => {
    const quota = donationQuota(useAuthStore().isVip)
    return state.value.day === dayKeyNow() ? Math.max(0, quota - state.value.donationsToday) : quota
  })
  /** 门人上限:山门定员(初始 10,每级 +1);门人自动补足,面板按「门人 N / N」显示 */
  const members = computed(() => memberCap(state.value.buildings.hall ?? 0))

  /** 服务端此刻(毫秒) */
  function serverNow(): number {
    return Date.now() + skew.value
  }

  /** 在造工程还剩多久(毫秒);无工程 → 0 */
  function remainingMs(): number {
    const task = state.value.build
    if (task === null) return 0
    return Math.max(0, task.finishAt - serverNow())
  }

  /** 把一份响应收进本地:状态与时钟对齐;ok=false 时只报原因 */
  function absorb(res: SectStateResp): boolean {
    skew.value = Number.isFinite(res.now) ? res.now - Date.now() : 0
    loaded.value = true
    if (!res.ok) {
      useUiStore().toast(REASON_TEXT[res.reason ?? 'error'] ?? '未能结算', 'warn')
      return false
    }
    state.value = res.state
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
  async function found(sectId: string, sectName: string): Promise<boolean> {
    const res = await run(() => cloudApi.sectFound(sectId, sectName))
    if (res === null) return false
    const ok = absorb(res)
    if (!ok) return false
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

  /** 登出/切号:清空,免得下一号看见上一号的门派 */
  function reset(): void {
    state.value = emptySectState()
    loaded.value = false
    skew.value = 0
  }

  return {
    state,
    loaded,
    pending,
    /** 服务端与本机的时差(毫秒):倒计时用 now + offset */
    offset: skew,
    rate,
    founded,
    name,
    personal,
    pool,
    mods,
    donationsLeft,
    members,
    skillLevel,
    buildingLevel,
    levelCap,
    serverNow,
    remainingMs,
    hydrate,
    load,
    found,
    donate,
    startBuild,
    claimBuild,
    learn,
    reset
  }
})
