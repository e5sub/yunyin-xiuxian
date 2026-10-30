<template>
  <div class="card-ink space-y-2 px-4 py-3">
    <p class="text-[11px] text-ink-faint">
      道号 <span class="font-kai text-[14px] text-ink">{{ auth.username }}</span>
      <span
        v-if="auth.isVip"
        class="ml-1.5 rounded-full bg-amber-ink/15 px-1.5 py-0.5 align-middle font-kai text-[10px] tracking-widest text-amber-ink"
      >VIP·{{ auth.vipDaysLeft }}天</span>
    </p>
    <div class="flex gap-2">
      <button class="btn-ghost flex-1 !text-[12px]" @click="openPassword">修改口令</button>
      <button class="btn-ghost flex-1 !text-[12px]" @click="openEmail">修改邮箱</button>
    </div>
    <button class="btn-ghost w-full !text-[12px]" @click="logoutOpen = true">登出</button>

    <!-- 修改口令 -->
    <BaseModal :open="pwOpen" title="修改口令" @close="pwOpen = false">
      <div class="space-y-2">
        <p class="text-[12px] leading-relaxed text-ink-soft">改完口令后本设备自动换新会话,其他设备将被挤下线。</p>
        <input
          v-model.trim="pwOld"
          type="password"
          maxlength="64"
          placeholder="当前口令"
          autocomplete="current-password"
          class="w-full rounded-lg border border-ink/15 bg-paper-deep/60 px-3 py-2 text-[13px] text-ink placeholder:text-ink-faint focus:border-cinnabar/60 focus:outline-none"
        />
        <input
          v-model.trim="pwNew"
          type="password"
          maxlength="64"
          placeholder="新口令(6~64 字)"
          autocomplete="new-password"
          class="w-full rounded-lg border border-ink/15 bg-paper-deep/60 px-3 py-2 text-[13px] text-ink placeholder:text-ink-faint focus:border-cinnabar/60 focus:outline-none"
        />
        <input
          v-model.trim="pwNew2"
          type="password"
          maxlength="64"
          placeholder="再输一遍新口令"
          autocomplete="new-password"
          class="w-full rounded-lg border border-ink/15 bg-paper-deep/60 px-3 py-2 text-[13px] text-ink placeholder:text-ink-faint focus:border-cinnabar/60 focus:outline-none"
        />
      </div>
      <template #footer>
        <div class="flex gap-2">
          <button class="btn-ghost flex-1" @click="pwOpen = false">取消</button>
          <button class="btn-seal flex-1" :disabled="pwBusy" @click="confirmPassword">
            {{ pwBusy ? '提交中……' : '确认修改' }}
          </button>
        </div>
      </template>
    </BaseModal>

    <!-- 修改邮箱 -->
    <BaseModal :open="emOpen" title="修改邮箱" @close="emOpen = false">
      <div class="space-y-2">
        <p class="text-[12px] leading-relaxed text-ink-soft">
          {{ emailEnabled ? '验证码将发到新邮箱,10 分钟内有效。' : '当前未开启邮箱服务,仅需当前口令确认。' }}
        </p>
        <input
          v-model.trim="emPassword"
          type="password"
          maxlength="64"
          placeholder="当前口令"
          autocomplete="current-password"
          class="w-full rounded-lg border border-ink/15 bg-paper-deep/60 px-3 py-2 text-[13px] text-ink placeholder:text-ink-faint focus:border-cinnabar/60 focus:outline-none"
        />
        <input
          v-model.trim="emNew"
          maxlength="190"
          placeholder="新邮箱"
          autocomplete="email"
          class="w-full rounded-lg border border-ink/15 bg-paper-deep/60 px-3 py-2 text-[13px] text-ink placeholder:text-ink-faint focus:border-cinnabar/60 focus:outline-none"
        />
        <div v-if="emailEnabled" class="flex gap-2">
          <input
            v-model.trim="emCode"
            maxlength="8"
            placeholder="邮箱验证码"
            class="flex-1 rounded-lg border border-ink/15 bg-paper-deep/60 px-3 py-2 text-[13px] text-ink placeholder:text-ink-faint focus:border-cinnabar/60 focus:outline-none"
          />
          <button class="btn-ghost !px-3 !text-[12px]" :disabled="codeCd > 0 || codeSending" @click="sendCode">
            {{ codeSending ? '发送中……' : codeCd > 0 ? `${codeCd}s` : '发验证码' }}
          </button>
        </div>
      </div>
      <template #footer>
        <div class="flex gap-2">
          <button class="btn-ghost flex-1" @click="emOpen = false">取消</button>
          <button class="btn-seal flex-1" :disabled="emBusy" @click="confirmEmail">
            {{ emBusy ? '提交中……' : '确认修改' }}
          </button>
        </div>
      </template>
    </BaseModal>

    <!-- 登出 -->
    <BaseModal :open="logoutOpen" title="登出" @close="logoutOpen = false">
      <p class="text-[13px] leading-relaxed text-ink-soft">登出后需重新登录 · 云端进度保留</p>
      <template #footer>
        <div class="flex gap-2">
          <button class="btn-ghost flex-1" @click="logoutOpen = false">再想想</button>
          <button class="btn-seal flex-1" @click="confirmLogout">确认登出</button>
        </div>
      </template>
    </BaseModal>
  </div>
</template>

<script setup lang="ts">
  import { onUnmounted, ref } from 'vue'
  import { useRouter } from 'vue-router'
  import { useAuthStore } from '@/stores/auth'
  import { useUiStore } from '@/stores/ui'
  import { cloudApi, disconnectCloudWs } from '@/services/cloud'
  import { stopCloudSync } from '@/core/cloudSave'
  import BaseModal from '@/components/common/BaseModal.vue'

  const router = useRouter()
  const auth = useAuthStore()
  const ui = useUiStore()
  const logoutOpen = ref(false)

  function confirmLogout(): void {
    logoutOpen.value = false
    stopCloudSync()
    disconnectCloudWs()
    auth.logout()
    void router.push('/login')
  }

  /* ---- 修改口令 ---- */
  const pwOpen = ref(false)
  const pwBusy = ref(false)
  const pwOld = ref('')
  const pwNew = ref('')
  const pwNew2 = ref('')

  function openPassword(): void {
    pwOld.value = ''
    pwNew.value = ''
    pwNew2.value = ''
    pwOpen.value = true
  }

  async function confirmPassword(): Promise<void> {
    if (pwBusy.value) return
    if (pwNew.value.length < 6 || pwNew.value.length > 64) {
      ui.toast('新口令 6~64 字', 'warn')
      return
    }
    if (pwNew.value !== pwNew2.value) {
      ui.toast('两次输入的新口令不一致', 'warn')
      return
    }
    pwBusy.value = true
    try {
      const res = await cloudApi.changePassword(pwOld.value, pwNew.value)
      // 旧 token 已随 pass_changed_at 作废,立刻换上服务端签发的新会话
      if (typeof res.token === 'string' && res.token !== '') auth.token = res.token
      pwOpen.value = false
      ui.toast('口令已修改', 'success')
    } catch (e) {
      ui.toast(e instanceof Error ? e.message : '修改失败', 'warn')
    } finally {
      pwBusy.value = false
    }
  }

  /* ---- 修改邮箱 ---- */
  const emOpen = ref(false)
  const emBusy = ref(false)
  const emPassword = ref('')
  const emNew = ref('')
  const emCode = ref('')
  const emailEnabled = ref(false)
  const codeSending = ref(false)
  const codeCd = ref(0)
  let cdTimer: ReturnType<typeof setInterval> | undefined

  async function openEmail(): Promise<void> {
    emPassword.value = ''
    emNew.value = ''
    emCode.value = ''
    emOpen.value = true
    // 邮箱服务开没开决定要不要验证码;拿不到就按需要验证码处理(多填一格不碍事)
    try {
      const c = await cloudApi.authConfig()
      emailEnabled.value = c.emailEnabled === true
    } catch {
      emailEnabled.value = true
    }
  }

  async function sendCode(): Promise<void> {
    if (codeSending.value || codeCd.value > 0) return
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emNew.value)) {
      ui.toast('请先填有效的新邮箱', 'warn')
      return
    }
    codeSending.value = true
    try {
      await cloudApi.emailCode(emNew.value, 'bind')
      ui.toast('验证码已发送', 'success')
      codeCd.value = 60
      cdTimer = setInterval(() => {
        codeCd.value -= 1
        if (codeCd.value <= 0 && cdTimer !== undefined) {
          clearInterval(cdTimer)
          cdTimer = undefined
        }
      }, 1000)
    } catch (e) {
      ui.toast(e instanceof Error ? e.message : '发送失败', 'warn')
    } finally {
      codeSending.value = false
    }
  }

  async function confirmEmail(): Promise<void> {
    if (emBusy.value) return
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emNew.value)) {
      ui.toast('请填写有效邮箱', 'warn')
      return
    }
    if (emailEnabled.value && emCode.value === '') {
      ui.toast('请填写邮箱验证码', 'warn')
      return
    }
    emBusy.value = true
    try {
      await cloudApi.changeEmail(emPassword.value, emNew.value, emCode.value)
      emOpen.value = false
      ui.toast('绑定邮箱已更新', 'success')
    } catch (e) {
      ui.toast(e instanceof Error ? e.message : '修改失败', 'warn')
    } finally {
      emBusy.value = false
    }
  }

  onUnmounted(() => {
    if (cdTimer !== undefined) clearInterval(cdTimer)
  })
</script>
