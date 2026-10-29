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

    const loggedIn = computed(() => token.value !== '' && userId.value > 0)

    /** 注册并登录(邮箱必填);失败抛 CloudError(界面取 message 显示) */
    async function register(name: string, email: string, password: string, code = ''): Promise<void> {
      const res = await cloudApi.register(name, email, password, code)
      applySession(res.token, res.user.id, res.user.username)
    }

    async function login(name: string, password: string): Promise<void> {
      const res = await cloudApi.login(name, password)
      applySession(res.token, res.user.id, res.user.username)
    }

    function logout(): void {
      token.value = ''
      userId.value = 0
      username.value = ''
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
      if (token.value === '' || userId.value <= 0) {
        token.value = ''
        userId.value = 0
        username.value = ''
      }
    }

    return {
      token,
      userId,
      username,
      loggedIn,
      register,
      login,
      logout,
      sanitize
    }
  },
  { persist: persistImmediateConfig('auth') }
)
