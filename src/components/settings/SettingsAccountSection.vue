<template>
  <div class="card-ink space-y-2 px-4 py-3">
    <p class="text-[11px] text-ink-faint">
      道号 <span class="font-kai text-[14px] text-ink">{{ auth.username }}</span>
    </p>
    <button class="btn-ghost w-full !text-[12px]" @click="logoutOpen = true">登出</button>

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
  import { ref } from 'vue'
  import { useRouter } from 'vue-router'
  import { useAuthStore } from '@/stores/auth'
  import { disconnectCloudWs } from '@/services/cloud'
  import { stopCloudSync } from '@/core/cloudSave'
  import BaseModal from '@/components/common/BaseModal.vue'

  const router = useRouter()
  const auth = useAuthStore()
  const logoutOpen = ref(false)

  function confirmLogout(): void {
    logoutOpen.value = false
    stopCloudSync()
    disconnectCloudWs()
    auth.logout()
    void router.push('/login')
  }
</script>
