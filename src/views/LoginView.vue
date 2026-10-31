<template>
  <div class="stagger-in flex min-h-full flex-col items-center justify-center px-8 py-10">
    <div class="grid h-20 w-20 place-items-center rounded-2xl bg-cinnabar shadow-lg shadow-cinnabar/30">
      <span class="font-kai text-[44px] leading-none text-paper">仙</span>
    </div>

    <h1 class="mt-5 font-kai text-[30px] leading-tight tracking-[0.3em] text-ink">云隐修仙录</h1>
    <p class="mt-1.5 text-[11px] tracking-[0.4em] text-ink-faint">网游玩法 · 进度存云端</p>

    <div class="mt-8 w-full max-w-72">
      <div class="grid grid-cols-2 rounded-lg border border-ink/15 p-1">
        <button
          class="rounded-md border py-1.5 text-[13px] tracking-[0.2em]"
          :class="mode === 'login' ? 'border-cinnabar bg-cinnabar text-paper' : 'border-ink/15 text-ink-faint'"
          @click="mode = 'login'"
        >
          登 录
        </button>
        <button
          class="rounded-md border py-1.5 text-[13px] tracking-[0.2em]"
          :class="mode === 'register' ? 'border-cinnabar bg-cinnabar text-paper' : 'border-ink/15 text-ink-faint'"
          @click="mode = 'register'"
        >
          注 册
        </button>
      </div>

      <form class="mt-4 space-y-3" @submit.prevent="onSubmit">
        <input
          v-model.trim="name"
          type="text"
          maxlength="12"
          autocomplete="username"
          placeholder="道号(2~12字)"
          class="w-full rounded-lg border border-ink/15 bg-paper-deep/60 px-3 py-2.5 text-[14px] text-ink placeholder:text-ink-faint focus:border-cinnabar/60 focus:outline-none"
        />
        <input
          v-if="mode === 'register'"
          v-model.trim="email"
          type="email"
          maxlength="190"
          autocomplete="email"
          placeholder="邮箱(找回口令用)"
          class="w-full rounded-lg border border-ink/15 bg-paper-deep/60 px-3 py-2.5 text-[14px] text-ink placeholder:text-ink-faint focus:border-cinnabar/60 focus:outline-none"
        />
        <div v-if="mode === 'register' && codeRequired" class="flex gap-2">
          <input
            v-model.trim="code"
            type="text"
            inputmode="numeric"
            maxlength="6"
            placeholder="邮箱验证码"
            class="min-w-0 flex-1 rounded-lg border border-ink/15 bg-paper-deep/60 px-3 py-2.5 text-[14px] text-ink placeholder:text-ink-faint focus:border-cinnabar/60 focus:outline-none"
          />
          <button
            type="button"
            class="shrink-0 rounded-lg border border-ink/15 px-3 text-[12px] text-ink-faint active:text-ink"
            :disabled="codeCooldown > 0"
            @click="sendRegisterCode"
          >
            {{ codeCooldown > 0 ? `${codeCooldown}s` : '发验证码' }}
          </button>
        </div>
        <input
          v-model="password"
          type="password"
          maxlength="64"
          :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
          placeholder="口令(6字以上)"
          class="w-full rounded-lg border border-ink/15 bg-paper-deep/60 px-3 py-2.5 text-[14px] text-ink placeholder:text-ink-faint focus:border-cinnabar/60 focus:outline-none"
        />
        <input
          v-if="mode === 'register'"
          v-model="password2"
          type="password"
          maxlength="64"
          autocomplete="new-password"
          placeholder="再录一遍口令"
          class="w-full rounded-lg border border-ink/15 bg-paper-deep/60 px-3 py-2.5 text-[14px] text-ink placeholder:text-ink-faint focus:border-cinnabar/60 focus:outline-none"
        />
        <!-- Turnstile 人机验证(服务端开启才渲染) -->
        <div v-show="tsOn" ref="tsBox" class="flex justify-center"></div>
        <p v-if="error" class="text-[11px] text-cinnabar">{{ error }}</p>
        <button type="submit" class="btn-seal w-full !py-3 text-[15px] tracking-[0.3em]" :disabled="busy">
          {{ busy ? '处理中' : mode === 'login' ? '入 道' : '开 山 门' }}
        </button>
      </form>

      <!-- 次要一步:与「入 道」同宽对齐,虚框一档,不做成孤零零一个窄框 -->
      <button
        v-if="mode === 'login'"
        class="btn-ghost mt-2.5 w-full !py-2 !tracking-[0.2em] text-[12px]"
        @click="forgotOpen = true"
      >
        忘记口令
      </button>
    </div>

    <BaseModal :open="forgotOpen" title="找回口令" @close="forgotOpen = false">
      <div class="space-y-3">
        <input
          v-model.trim="fpEmail"
          type="email"
          maxlength="190"
          placeholder="注册邮箱"
          class="w-full rounded-lg border border-ink/15 bg-paper-deep/60 px-3 py-2.5 text-[14px] text-ink placeholder:text-ink-faint focus:border-cinnabar/60 focus:outline-none"
        />
        <div class="flex gap-2">
          <input
            v-model.trim="fpCode"
            type="text"
            inputmode="numeric"
            maxlength="6"
            placeholder="验证码"
            class="min-w-0 flex-1 rounded-lg border border-ink/15 bg-paper-deep/60 px-3 py-2.5 text-[14px] text-ink placeholder:text-ink-faint focus:border-cinnabar/60 focus:outline-none"
          />
          <button
            type="button"
            class="shrink-0 rounded-lg border border-ink/15 px-3 text-[12px] text-ink-faint active:text-ink"
            :disabled="fpCooldown > 0"
            @click="sendForgotCode"
          >
            {{ fpCooldown > 0 ? `${fpCooldown}s` : '发验证码' }}
          </button>
        </div>
        <input
          v-model="fpPassword"
          type="password"
          maxlength="64"
          autocomplete="new-password"
          placeholder="新口令(6字以上)"
          class="w-full rounded-lg border border-ink/15 bg-paper-deep/60 px-3 py-2.5 text-[14px] text-ink placeholder:text-ink-faint focus:border-cinnabar/60 focus:outline-none"
        />
        <div v-show="tsOn" ref="fpTsBox" class="flex justify-center"></div>
        <p v-if="forgotMsg !== ''" class="text-[11px]" :class="forgotOk ? 'text-teal-700' : 'text-cinnabar'">
          {{ forgotMsg }}
        </p>
      </div>
      <template #footer>
        <div class="flex gap-2">
          <button class="btn-ghost flex-1" @click="forgotOpen = false">再想想</button>
          <button class="btn-seal flex-1" :disabled="forgotBusy" @click="doReset">重置口令</button>
        </div>
      </template>
    </BaseModal>
  </div>
</template>

<script setup lang="ts">
  import { nextTick, onMounted, ref, watch } from 'vue'
  import { useRouter } from 'vue-router'
  import { useAuthStore } from '@/stores/auth'
  import { useGameStore } from '@/stores/game'
  import { useUiStore } from '@/stores/ui'
  import { CloudError, cloudApi, connectCloudWs } from '@/services/cloud'
  import { pullCloudSave, startCloudSync } from '@/core/cloudSave'
  import BaseModal from '@/components/common/BaseModal.vue'
  import {
    configureTurnstile,
    renderTurnstile,
    resetTurnstile,
    turnstileEnabled,
    turnstileToken
  } from '@/utils/turnstile'

  const router = useRouter()
  const auth = useAuthStore()
  const game = useGameStore()
  const ui = useUiStore()

  const mode = ref<'login' | 'register'>('login')
  const name = ref('')
  const email = ref('')
  const code = ref('')
  const password = ref('')
  const password2 = ref('')
  const error = ref('')
  const busy = ref(false)

  /** 服务端开关:注册是否强制邮箱验证码(EMAIL_CODE_REQUIRED) */
  const codeRequired = ref(false)
  const codeCooldown = ref(0)

  const forgotOpen = ref(false)
  const fpEmail = ref('')
  const fpCode = ref('')
  const fpPassword = ref('')
  const fpCooldown = ref(0)
  const forgotMsg = ref('')
  const forgotOk = ref(false)
  const forgotBusy = ref(false)

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

  /** Turnstile 人机验证:/auth/config 下发站点密钥才有;token 单次有效,每用一次重挂 */
  const tsOn = ref(false)
  const tsBox = ref<HTMLElement | null>(null)
  const fpTsBox = ref<HTMLElement | null>(null)

  function tsReady(box: HTMLElement | null): string {
    if (!tsOn.value || box === null) return ''
    return turnstileToken(box)
  }

  function tsReset(box: HTMLElement | null): void {
    if (box !== null) resetTurnstile(box)
  }

  onMounted(() => {
    void cloudApi
      .authConfig()
      .then(c => {
        codeRequired.value = c.emailCodeRequired
        configureTurnstile(c.turnstileSiteKey ?? '')
        tsOn.value = c.turnstileEnabled === true && turnstileEnabled()
        if (tsOn.value) void nextTick(() => void renderTurnstile(tsBox.value!))
      })
      .catch(() => undefined)
  })

  // 找回口令弹层里的挂件:开弹层时容器才在 DOM 里,现挂现用
  watch(forgotOpen, open => {
    if (open && tsOn.value) void nextTick(() => void renderTurnstile(fpTsBox.value!))
  })

  function sendRegisterCode(): void {
    if (!EMAIL_RE.test(email.value)) {
      error.value = '请填写有效邮箱'
      return
    }
    const token = tsReady(tsBox.value)
    if (tsOn.value && token === '') {
      error.value = '请先完成人机验证'
      return
    }
    error.value = ''
    void cloudApi
      .emailCode(email.value, 'register', token)
      .then(r => {
        if (r.devCode !== undefined) ui.toast(`验证码 ${r.devCode}`, 'success')
        else ui.toast('验证码已发送', 'success')
      })
      .catch(e => {
        error.value = e instanceof CloudError ? e.message : '发送失败'
      })
      .finally(() => tsReset(tsBox.value))
    codeCooldown.value = 60
    const iv = setInterval(() => {
      codeCooldown.value -= 1
      if (codeCooldown.value <= 0) clearInterval(iv)
    }, 1000)
  }

  function sendForgotCode(): void {
    if (!EMAIL_RE.test(fpEmail.value)) {
      forgotMsg.value = '请填写有效邮箱'
      forgotOk.value = false
      return
    }
    const token = tsReady(fpTsBox.value)
    if (tsOn.value && token === '') {
      forgotMsg.value = '请先完成人机验证'
      forgotOk.value = false
      return
    }
    void cloudApi
      .forgot(fpEmail.value, token)
      .then(r => {
        forgotMsg.value = r.devCode !== undefined ? `验证码 ${r.devCode}` : '验证码已发送'
        forgotOk.value = true
      })
      .catch(e => {
        forgotMsg.value = e instanceof CloudError ? e.message : '发送失败'
        forgotOk.value = false
      })
      .finally(() => tsReset(fpTsBox.value))
    fpCooldown.value = 60
    const iv = setInterval(() => {
      fpCooldown.value -= 1
      if (fpCooldown.value <= 0) clearInterval(iv)
    }, 1000)
  }

  async function doReset(): Promise<void> {
    if (forgotBusy.value) return
    if (!EMAIL_RE.test(fpEmail.value)) {
      forgotMsg.value = '请填写有效邮箱'
      forgotOk.value = false
      return
    }
    if (fpCode.value === '') {
      forgotMsg.value = '请填验证码'
      forgotOk.value = false
      return
    }
    if (fpPassword.value.length < 6) {
      forgotMsg.value = '口令太短'
      forgotOk.value = false
      return
    }
    const token = tsReady(fpTsBox.value)
    if (tsOn.value && token === '') {
      forgotMsg.value = '请先完成人机验证'
      forgotOk.value = false
      return
    }
    forgotBusy.value = true
    try {
      await cloudApi.resetPassword(fpEmail.value, fpCode.value, fpPassword.value, token)
      forgotMsg.value = '口令已重置'
      forgotOk.value = true
      fpEmail.value = ''
      fpCode.value = ''
      fpPassword.value = ''
      setTimeout(() => {
        forgotOpen.value = false
        mode.value = 'login'
        forgotMsg.value = ''
      }, 800)
    } catch (e) {
      forgotMsg.value = e instanceof CloudError ? e.message : '重置失败'
      forgotOk.value = false
    }
    tsReset(fpTsBox.value)
    forgotBusy.value = false
  }

  async function onSubmit(): Promise<void> {
    if (busy.value) return
    error.value = ''
    if (name.value.length < 2) {
      error.value = '道号太短'
      return
    }
    if (mode.value === 'register') {
      if (!EMAIL_RE.test(email.value)) {
        error.value = '请填写有效邮箱'
        return
      }
      if (codeRequired.value && code.value === '') {
        error.value = '请填邮箱验证码'
        return
      }
    }
    if (password.value.length < 6) {
      error.value = '口令太短'
      return
    }
    if (mode.value === 'register' && password2.value !== password.value) {
      error.value = '两次口令不一致'
      return
    }
    const token = mode.value === 'register' ? tsReady(tsBox.value) : ''
    if (mode.value === 'register' && tsOn.value && token === '') {
      error.value = '请先完成人机验证'
      return
    }
    busy.value = true
    try {
      if (mode.value === 'login') await auth.login(name.value, password.value)
      else await auth.register(name.value, email.value, password.value, code.value, token)
    } catch (e) {
      error.value = e instanceof CloudError ? e.message : '请求失败'
      busy.value = false
      if (mode.value === 'register') tsReset(tsBox.value)
      return
    }
    if (mode.value === 'register') tsReset(tsBox.value)
    connectCloudWs()
    try {
      const r = await pullCloudSave()
      if (r.status === 'applied') return // 已重载进游戏
      if (r.status === 'error') {
        // 云端有档但应用失败:绝不能进空档流程,否则开局后的自动上传会把云端原档推平
        error.value = `云端存档读取失败(${r.message}),请重试或联系仙官`
        busy.value = false
        return
      }
    } catch (e) {
      // 网络失败不拦登录:此时锚点为 0,上传会被服务端判冲突挡下,不会覆盖云端
      ui.toast(e instanceof CloudError ? `云存档拉取失败:${e.message}` : '云存档拉取失败', 'warn')
    }
    // App 挂载时用户还在登录页,bootstrapCloud 直接返回了;登录成功后必须在这里启动同步循环,
    // 否则整局都不会上传(换设备即丢档)
    startCloudSync()
    busy.value = false
    void router.push(game.started ? '/' : '/welcome')
  }
</script>
