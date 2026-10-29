<template>
  <div class="stagger-in flex min-h-full flex-col items-center justify-center px-8 py-10">
    <div class="grid h-24 w-24 place-items-center rounded-2xl bg-cinnabar shadow-lg shadow-cinnabar/30">
      <span class="font-kai text-[56px] leading-none text-paper">道</span>
    </div>

    <h1 class="mt-6 font-kai text-[40px] leading-tight tracking-[0.3em] text-ink">云隐修仙录</h1>
    <p class="mt-2 text-[12px] tracking-[0.5em] text-ink-faint">一念修行 · 云深不知处</p>

    <button class="btn-seal mt-10 w-full max-w-72 !py-3.5 text-[17px] tracking-[0.3em]" @click="onStart">开 始 游 戏</button>

    <div class="mt-6 flex items-center gap-3 text-[11px] text-ink-faint">
      <button class="inline-flex min-h-[28px] items-center active:text-ink-soft" @click="privacyOpen = true">隐私政策</button>
      <span class="text-ink-faint">·</span>
      <button class="inline-flex min-h-[28px] items-center active:text-ink-soft" @click="aboutOpen = true">关于我们</button>
    </div>

    <AboutDialog :open="aboutOpen" @close="aboutOpen = false" />

    <PrivacyDialog :open="privacyOpen" @close="privacyOpen = false" />

    <BaseModal :open="agreeOpen" title="进入确认" :closable="false">
      <p class="text-[12px] leading-relaxed text-ink-faint">游戏数据存云端 · 登录即自动同步</p>
      <label class="mt-3 flex items-center gap-2">
        <input v-model="agreed" type="checkbox" class="h-4 w-4 accent-cinnabar" />
        <span class="text-[12px] text-ink-soft">
          我已阅读并同意
          <!-- 行内按钮命中区只有 17px;内联块给拇指 30px 靶面 -->
          <button class="inline-block py-1.5 text-azure" @click.prevent="privacyOpen = true">《隐私政策》</button>
        </span>
      </label>
      <template #footer>
        <div class="flex gap-2">
          <button class="btn-ghost flex-1" @click="agreeOpen = false">再想想</button>
          <button class="btn-seal flex-1" :disabled="!agreed" @click="confirmStart">同意并开始</button>
        </div>
      </template>
    </BaseModal>

    <WarpPortal ref="warpRef" />
  </div>
</template>

<script setup lang="ts">
  import { onUnmounted, ref } from 'vue'
  import { useRouter } from 'vue-router'
  import { useSettingsStore } from '@/stores/settings'
  import BaseModal from '@/components/common/BaseModal.vue'
  import PrivacyDialog from '@/components/common/PrivacyDialog.vue'
  import AboutDialog from '@/components/common/AboutDialog.vue'
  import WarpPortal from '@/components/common/WarpPortal.vue'

  const router = useRouter()
  const settings = useSettingsStore()

  const privacyOpen = ref(false)
  const agreeOpen = ref(false)
  const agreed = ref(false)
  const aboutOpen = ref(false)
  const warpRef = ref<InstanceType<typeof WarpPortal> | null>(null)
  let enterTimer: ReturnType<typeof setTimeout> | undefined

  function onStart(): void {
    if (settings.privacyAccepted) {
      void router.push('/create')
      return
    }
    agreeOpen.value = true
  }

  function confirmStart(): void {
    settings.privacyAccepted = true
    agreeOpen.value = false
    warpRef.value?.show({ title: '云深不知处', subtitle: '仙路自此始' })
    enterTimer = setTimeout(() => {
      void router.push('/create')
    }, 2500)
  }

  onUnmounted(() => {
    if (enterTimer !== undefined) clearTimeout(enterTimer)
  })
</script>
