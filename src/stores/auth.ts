/** 网游账号:注册 / 登录 / 会话。token 持久化,断线重连不丢登录 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { persistImmediateConfig } from '@/utils/storage'
import { asFiniteNumber } from '@/utils/saveShape'
import { cloudApi } from '@/services/cloud'

export const useAuthStore = defineStore(
  'auth',
  () => {
    const token = ref('')
    const userId = ref(0)
    const username = ref('')
    /** VIP 到期毫秒时间戳;0 = 未开通。随登录/注册/me 刷新下发 */
    const vipUntil = ref(0)

    const loggedIn = computed(() => token.value !== '' && userId.value > 0)
    /** 眼下是否 VIP(到期即失格);每秒级的到期动画不需要,托管循环 tick 里会兜底复核 */
    const isVip = computed(() => vipUntil.value > Date.now())
    /** VIP 剩余天数(向上取整;未开通为 0) */
    const vipDaysLeft = computed(() => (isVip.value ? Math.ceil((vipUntil.value - Date.now()) / 86400000) : 0))

    /** 注册并登录(邮箱必填);失败抛 CloudError(界面取 message 显示) */
    async function register(name: string, email: string, password: string, code = ''): Promise<void> {
      const res = await cloudApi.register(name, email, password, code)
      applySession(res.token, res.user.id, res.user.username)
      vipUntil.value = Math.max(0, Math.floor(res.user.vipUntil ?? 0))
    }

    async function login(name: string, password: string): Promise<void> {
      const res = await cloudApi.login(name, password)
      applySession(res.token, res.user.id, res.user.username)
      vipUntil.value = Math.max(0, Math.floor(res.user.vipUntil ?? 0))
    }

    /** 会话信息刷新(GM 后台发放/续期后,玩家刷新页面即拿到新 VIP 状态) */
    async function refreshVip(): Promise<void> {
      if (!loggedIn.value) return
      const res = await cloudApi.me()
      vipUntil.value = Math.max(0, Math.floor(res.user.vipUntil ?? 0))
    }

    function logout(): void {
      token.value = ''
      userId.value = 0
      username.value = ''
      vipUntil.value = 0
    }

    function applySession(t: string, id: number, name: string): void {
      token.value = t
      userId.value = id
      username.value = name
    }

    function sanitize(): void {
      token.value = typeof token.value === 'string' ? token.value : ''
      userId.value = Math.max(0, Math.floor(asFiniteNumber(userId.value, 0, 0)))
      username.value = typeof username.value === 'string' ? username.value : ''
      vipUntil.value = Math.max(0, Math.floor(asFiniteNumber(vipUntil.value, 0, 0)))
      if (token.value === '' || userId.value <= 0) {
        token.value = ''
        userId.value = 0
        username.value = ''
        vipUntil.value = 0
      }
    }

    return {
      token,
      userId,
      username,
      vipUntil,
      loggedIn,
      isVip,
      vipDaysLeft,
      register,
      login,
      refreshVip,
      logout,
      sanitize
    }
  },
  { persist: persistImmediateConfig('auth') }
)
