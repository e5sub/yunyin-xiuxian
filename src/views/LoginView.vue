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
          class="rounded-md py-1.5 text-[13px] tracking-[0.2em]"
          :class="mode === 'login' ? 'bg-cinnabar text-paper' : 'text-ink-faint'"
          @click="mode = 'login'"
        >
          登 录
        </button>
        <button
          class="rounded-md py-1.5 text-[13px] tracking-[0.2em]"
          :class="mode === 'register' ? 'bg-cinnabar text-paper' : 'text-ink-faint'"
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
          v-model="password"
          type="password"
          maxlength="64"
          :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
          placeholder="口令(6字以上)"
          class="w-full rounded-lg border border-ink/15 bg-paper-deep/60 px-3 py-2.5 text-[14px] text-ink placeholder:text-ink-faint focus:border-cinnabar/60 focus:outline-none"
        />
        <p v-if="error" class="text-[11px] text-cinnabar">{{ error }}</p>
        <button type="submit" class="btn-seal w-full !py-3 text-[15px] tracking-[0.3em]" :disabled="busy">
          {{ busy ? '处理中' : mode === 'login' ? '入 道' : '开 山 门' }}
        </button>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { ref } from 'vue'
  import { useRouter } from 'vue-router'
  import { useAuthStore } from '@/stores/auth'
  import { useGameStore } from '@/stores/game'
  import { CloudError, connectCloudWs } from '@/services/cloud'
  import { pullCloudSave } from '@/core/cloudSave'

  const router = useRouter()
  const auth = useAuthStore()
  const game = useGameStore()

  const mode = ref<'login' | 'register'>('login')
  const name = ref('')
  const password = ref('')
  const error = ref('')
  const busy = ref(false)

  async function onSubmit(): Promise<void> {
    if (busy.value) return
    error.value = ''
    if (name.value.length < 2) {
      error.value = '道号太短'
      return
    }
    if (password.value.length < 6) {
      error.value = '口令太短'
      return
    }
    busy.value = true
    try {
      if (mode.value === 'login') await auth.login(name.value, password.value)
      else await auth.register(name.value, password.value)
    } catch (e) {
      error.value = e instanceof CloudError ? e.message : '请求失败'
      busy.value = false
      return
    }
    connectCloudWs()
    try {
      const r = await pullCloudSave()
      if (r === 'applied' || r === 'error') return // applied 已重载;error 走空档流程从头开局
    } catch {
      // 拉取失败不拦登录:本地照常进入
    }
    busy.value = false
    void router.push(game.started ? '/' : '/welcome')
  }
</script>
