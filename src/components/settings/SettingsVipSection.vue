<template>
  <div class="card-ink divide-y divide-ink/6 px-4">
    <!-- VIP 状态行 -->
    <div class="flex items-center justify-between py-3">
      <div class="min-w-0">
        <span class="text-[13px] text-ink-soft">VIP 状态</span>
        <p class="mt-0.5 text-[10px] leading-relaxed text-ink-faint">
          {{ statusText }}
        </p>
      </div>
      <span
        class="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-kai tracking-widest"
        :class="auth.isVip ? 'bg-amber-ink/15 text-amber-ink' : 'bg-ink/10 text-ink-faint'"
      >VIP</span>
    </div>

    <!-- 激活码兑换(开通/续期皆可,永久卡直接补足到永久;已是永久则无需再兑) -->
    <div v-if="!auth.vipForever" class="py-3">
      <label class="flex items-center justify-between">
        <span class="text-[13px] text-ink-soft">激活码兑换</span>
        <button
          type="button"
          class="chip-ink !py-1.5"
          :class="codeInput.trim() === '' ? 'border-ink/25 text-ink-faint' : 'border-cinnabar text-cinnabar'"
          :disabled="redeeming || codeInput.trim() === ''"
          @click="redeem"
        >
          {{ redeeming ? '兑换中…' : '兑换' }}
        </button>
      </label>
      <input
        v-model="codeInput"
        class="mt-2 w-full rounded border border-ink/20 bg-transparent px-2 py-1.5 font-mono text-[12px] tracking-wider text-ink placeholder:text-ink-faint"
        placeholder="VIP-XXXX-XXXX-XXXX"
        maxlength="20"
        @keyup.enter="redeem"
      />
      <p class="mt-1 text-[10px] leading-relaxed text-ink-faint">
        月卡 / 半年卡 / 年卡在剩余时长上叠加;永久卡立即转为永久 VIP。找仙官(GM)获取激活码
      </p>
    </div>

    <!-- 支付宝扫码自助开通 -->
    <div v-if="buyEnabled" class="py-3">
      <span class="text-[13px] text-ink-soft">支付宝扫码开通</span>
      <div class="mt-2 grid grid-cols-4 gap-2">
        <button
          v-for="t in BUY_TYPES"
          :key="t.type"
          type="button"
          class="rounded border px-1 py-2 text-center"
          :class="priceOf(t.type) > 0 ? 'border-ink/25 text-ink active:bg-ink/5' : 'border-ink/10 text-ink-faint'"
          :disabled="priceOf(t.type) <= 0"
          @click="buy(t.type)"
        >
          <span class="block text-[12px]">{{ t.label }}</span>
          <span class="block text-[10px] text-ink-faint">{{ priceOf(t.type) > 0 ? `¥${priceOf(t.type)}` : '未开放' }}</span>
        </button>
      </div>
      <p class="mt-1 text-[10px] leading-relaxed text-ink-faint">
        手机支付宝扫码支付,到账自动开通;月/半年/年在剩余时长上叠加
      </p>
    </div>

    <template v-if="auth.isVip">
      <!-- 一键托管 -->
      <div class="flex items-center justify-between py-3">
        <span class="text-[13px] text-ink-soft">一键托管</span>
        <button
          type="button"
          class="chip-ink !py-1.5"
          :class="allOn ? 'border-cinnabar text-cinnabar' : 'border-ink/25 text-ink-faint'"
          @click="toggleAll"
        >
          {{ allOn ? '全关' : '全开' }}
        </button>
      </div>

      <!-- 三项托管:一行三个滑块,各自独立 -->
      <div class="py-3">
        <div class="grid grid-cols-3 gap-2">
          <div v-for="item in AUTO_ITEMS" :key="item.key" class="flex flex-col items-center gap-2">
            <ToggleSwitch v-model="settings[item.key]" :label="item.label" />
            <span
              class="text-center text-[11px] leading-tight"
              :class="settings[item.key] ? 'text-ink' : 'text-ink-faint'"
            >{{ item.label }}</span>
          </div>
        </div>
        <p class="mt-2 text-[10px] leading-relaxed text-ink-faint">
          三项托管各自独立,想开哪项开哪项;历练与闭关都开时历练优先,历练间隙才闭关
        </p>
        <p class="mt-1 text-[10px] leading-relaxed text-ink-faint">
          打 BOSS 量力而行:能补刀先补刀,站得住便出剑;力有不及则蓄势,临期兜底出手。
          出剑无资粮,妖王被推倒时凡出过剑者按功均分击杀赏
        </p>
        <label class="mt-2 flex items-center justify-between gap-2">
          <span class="shrink-0 text-[11px] text-ink-faint">围妖难度</span>
          <select v-model="settings.bossDifficulty" class="min-w-0 grow rounded border border-ink/20 bg-transparent px-1.5 py-1 text-[12px] text-ink">
            <option v-for="d in BOSS_DIFFICULTY_OPTIONS" :key="d.key" :value="d.key">{{ d.name }}({{ d.desc }})</option>
          </select>
        </label>
        <div v-if="settings.autoAdventure" class="mt-2 space-y-2">
          <label class="flex items-center justify-between gap-2">
            <span class="shrink-0 text-[11px] text-ink-faint">历练去处</span>
            <select v-model="settings.autoRegionId" class="min-w-0 grow rounded border border-ink/20 bg-transparent px-1.5 py-1 text-[12px] text-ink">
              <option :value="AUTO_REGION_ID">自动择地(随境界推进)</option>
              <option value="" disabled>手工指定一处</option>
              <option v-for="r in enterableRegions" :key="r.id" :value="r.id">{{ r.name }}</option>
            </select>
          </label>
          <label class="flex items-center justify-between gap-2">
            <span class="shrink-0 text-[11px] text-ink-faint">出行档位</span>
            <select v-model="settings.autoMode" class="min-w-0 grow rounded border border-ink/20 bg-transparent px-1.5 py-1 text-[12px] text-ink">
              <option v-for="(m, id) in EXPLORE_MODES" :key="id" :value="id">{{ m.name }}({{ classicalDuration(m.durationSec) }})</option>
            </select>
          </label>
          <p v-if="settings.autoRegionId === AUTO_REGION_ID" class="text-[10px] leading-relaxed text-ink-faint">
            自动择地:每次出行前按实战同源试算遇敌胜率,取<span class="text-ink">最深且站得住</span>的一处;
            所选档位过于凶险会自动退到最稳档,力有不及则不出行(败则中断行程、负伤,白耗时辰)
          </p>
          <p v-if="planHint !== ''" class="text-[10px] leading-relaxed text-gold-ink">{{ planHint }}</p>
          <p v-if="settings.autoRegionId === ''" class="text-[10px] text-cinnabar">须先选历练去处,否则托管不出行</p>
        </div>
      </div>
    </template>

    <!-- 扫码支付弹窗 -->
    <BaseModal :open="pay !== null" title="支付宝扫码支付" @close="closePay">
      <div v-if="pay" class="flex flex-col items-center gap-3 py-2">
        <p class="text-[13px] text-ink">
          {{ pay.label }} · <span class="font-kai text-[18px] text-cinnabar">¥{{ pay.amountYuan }}</span>
        </p>
        <img v-if="pay.qrDataUrl !== ''" :src="pay.qrDataUrl" alt="支付宝收款码" class="h-56 w-56 rounded border border-ink/15 bg-white p-1" />
        <p class="text-[11px] text-ink-faint">{{ payHint }}</p>
        <p v-if="pay.expireLeft > 0" class="text-[10px] tabular text-ink-faint">
          二维码 {{ Math.ceil(pay.expireLeft / 60000) }} 分钟内有效
        </p>
        <button type="button" class="chip-ink !py-1.5" @click="closePay">关闭</button>
      </div>
    </BaseModal>
  </div>
</template>

<script setup lang="ts">
  import { computed, onMounted, onUnmounted, ref } from 'vue'
  import { useSettingsStore } from '@/stores/settings'
  import { useAuthStore } from '@/stores/auth'
  import { useUiStore } from '@/stores/ui'
  import { cloudApi, type VipPurchaseType } from '@/services/cloud'
  import { canEnterRegion } from '@/core/mortalWorldService'
  import { AUTO_REGION_ID, EXPLORE_MODES } from '@/data/constants'
  import { REGIONS } from '@/data/regions'
  import { BOSS_DIFFICULTY_OPTIONS } from '@/data/bossDifficulty'
  import { classicalDuration } from '@/data/timeUnits'
  import { winBandText } from '@/ui/adventureText'
  import { planAutoAdventure } from '@/core/autoOps'
  import BaseModal from '@/components/common/BaseModal.vue'
  import ToggleSwitch from '@/components/common/ToggleSwitch.vue'

  const settings = useSettingsStore()
  const auth = useAuthStore()
  const ui = useUiStore()

  const statusText = computed(() => {
    if (!auth.isVip) return '未开通 · 扫码/激活码自助开通,或联系仙官(GM)'
    if (auth.vipForever) return '永久 VIP · 尊享全部托管特权'
    return `剩余 ${auth.vipDaysLeft} 天(至 ${expireText.value})`
  })

  const codeInput = ref('')
  const redeeming = ref(false)

  async function redeem(): Promise<void> {
    const code = codeInput.value.trim().toUpperCase()
    if (code === '' || redeeming.value) return
    redeeming.value = true
    try {
      const r = await cloudApi.redeemVip(code)
      await auth.refreshVip()
      codeInput.value = ''
      ui.toast(r.days === 0 ? '兑换成功:VIP 已转为永久!' : `兑换成功:VIP +${r.days} 天`, 'success')
    } catch (e) {
      ui.toast(e instanceof Error ? e.message : '兑换失败', 'warn')
    } finally {
      redeeming.value = false
    }
  }

  /* ---------------- 支付宝扫码开通 ---------------- */

  const BUY_TYPES: Array<{ type: VipPurchaseType; label: string }> = [
    { type: 'month', label: '月卡' },
    { type: 'half', label: '半年卡' },
    { type: 'year', label: '年卡' },
    { type: 'forever', label: '永久卡' }
  ]
  const BUY_LABEL: Record<VipPurchaseType, string> = { month: '月卡', half: '半年卡', year: '年卡', forever: '永久卡' }

  const pricing = ref<{ enabled: boolean; prices: Record<VipPurchaseType, number> } | null>(null)
  const buyEnabled = computed(() => pricing.value !== null && pricing.value.enabled)

  onMounted(() => {
    void cloudApi
      .vipPricing()
      .then(p => {
        pricing.value = p
      })
      .catch(() => undefined)
  })

  function priceOf(type: VipPurchaseType): number {
    return pricing.value?.prices[type] ?? 0
  }

  interface PayState {
    outTradeNo: string
    label: string
    amountYuan: number
    qrDataUrl: string
    /** 本地倒计时用的绝对到期时间;<=0 表示已停轮询 */
    expireAt: number
    expireLeft: number
  }
  const pay = ref<PayState | null>(null)
  const payHint = ref('请用支付宝扫码支付,支付成功自动开通')
  let pollTimer: ReturnType<typeof setInterval> | undefined
  let tickTimer: ReturnType<typeof setInterval> | undefined

  async function buy(type: VipPurchaseType): Promise<void> {
    if (!auth.loggedIn) {
      ui.toast('请先登录后再开通', 'warn')
      return
    }
    if (priceOf(type) <= 0) return
    try {
      const r = await cloudApi.vipCreateOrder(type)
      payHint.value = '请用支付宝扫码支付,支付成功自动开通'
      pay.value = {
        outTradeNo: r.outTradeNo,
        label: BUY_LABEL[type],
        amountYuan: r.amountYuan,
        qrDataUrl: r.qrDataUrl,
        expireAt: r.expireAt,
        expireLeft: r.expireAt - Date.now()
      }
      startPolling()
    } catch (e) {
      ui.toast(e instanceof Error ? e.message : '下单失败', 'warn')
    }
  }

  function startPolling(): void {
    stopPolling()
    tickTimer = setInterval(() => {
      if (pay.value !== null) pay.value.expireLeft = pay.value.expireAt - Date.now()
    }, 1000)
    pollTimer = setInterval(() => void pollOnce(), 3000)
  }

  function stopPolling(): void {
    if (pollTimer !== undefined) clearInterval(pollTimer)
    if (tickTimer !== undefined) clearInterval(tickTimer)
    pollTimer = undefined
    tickTimer = undefined
  }

  async function pollOnce(): Promise<void> {
    const p = pay.value
    if (p === null) return
    if (Date.now() > p.expireAt) {
      payHint.value = '二维码已超时,请重新下单'
      closePay()
      return
    }
    try {
      const r = await cloudApi.vipOrderStatus(p.outTradeNo)
      if (r.status === 'paid') {
        stopPolling()
        pay.value = null
        await auth.refreshVip()
        ui.toast('支付成功,VIP 已开通!', 'success')
      } else if (r.status === 'closed') {
        payHint.value = '订单已关闭,请重新下单'
        closePay()
      }
    } catch {
      // 网络/网关抖动:保持轮询
    }
  }

  function closePay(): void {
    stopPolling()
    pay.value = null
  }

  onUnmounted(() => {
    stopPolling()
  })

  /** 一行三滑块:key 直指 settings 字段,点滑块即翻转 */
  const AUTO_ITEMS: ReadonlyArray<{ key: 'autoBoss' | 'autoRetreat' | 'autoAdventure'; label: string }> = [
    { key: 'autoBoss', label: '自动打 BOSS' },
    { key: 'autoRetreat', label: '自动闭关' },
    { key: 'autoAdventure', label: '自动历练' }
  ]

  const allOn = computed(() => settings.autoBoss && settings.autoRetreat && settings.autoAdventure)

  function toggleAll(): void {
    const next = !allOn.value
    settings.autoBoss = next
    settings.autoRetreat = next
    settings.autoAdventure = next
  }

  /**
   * 当前可进入的地界:须与历练入口同口径(canEnterRegion)。
   * 不能只读 adventure.unlocked —— 本世路线上新开的一段常常不在那份旧链里,会漏掉。
   */
  const enterableRegions = computed(() => REGIONS.filter(r => canEnterRegion(r.id)))

  /**
   * 自动择地眼下会去哪:与托管同一套决策(core/autoOps 的 planAutoAdventure),
   * 设置页先让人看明白,不必等出门才知道。试打很轻(至多三处 × 三场),失败就当没说。
   */
  const planHint = computed(() => {
    if (settings.autoRegionId !== AUTO_REGION_ID) return ''
    try {
      const plan = planAutoAdventure(settings.autoMode)
      if (plan === null) return '此刻无可战之地 · 先提升修为,或改选一处能去的地界'
      const where = `${plan.regionName} · ${EXPLORE_MODES[plan.mode].name}`
      const band = winBandText(plan.winRate)
      if (plan.reason === 'safer') return `托管会去:${where}(${band})· 所选档位力有不及,已退到最稳档`
      if (plan.reason === 'ceiling') return `托管会去:${where}(${band})· 前路已靖,聊作温养`
      return `托管会去:${where}(${band})`
    } catch {
      return ''
    }
  })

  const expireText = computed(() =>
    new Date(auth.vipUntil).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
  )
</script>
