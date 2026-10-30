<template>
  <div class="card-ink space-y-2 px-4 py-3">
    <p class="text-[11px] text-ink-faint tabular">
      存档版本 v{{ SAVE_VERSION }} · 修行时长 {{ formatDuration(game.totalPlaySec) }}
    </p>
    <p class="text-[11px] text-ink-faint tabular">道号 {{ auth.username || '未登录' }} · 服务器 {{ serverText }}</p>
    <p class="text-[11px] tabular" :class="syncTone">云同步 {{ syncText }}</p>
    <p
      v-if="syncState === 'conflict'"
      class="rounded-md border border-cinnabar/40 bg-cinnabar/8 px-2 py-1.5 text-[11px] leading-relaxed text-cinnabar"
    >
      云端存档已被更新过，本机已暂停上传以免覆盖。本机进度更新就「立即上传」，否则「从云端恢复」。
    </p>
    <p v-if="saveFailed" class="rounded-md border border-cinnabar/40 bg-cinnabar/8 px-2 py-1.5 text-[11px] leading-relaxed text-cinnabar">
      存档写入失败
    </p>
    <!-- 坏档分片须常驻一条:启动提示只有 2.4 秒 -->
    <p
      v-if="corruptedNotice.length"
      class="rounded-md border border-cinnabar/40 bg-cinnabar/8 px-2 py-1.5 text-[11px] leading-relaxed text-cinnabar"
    >
      存档损坏:{{ corruptedNotice.map(id => STORE_NAMES[id] ?? id).join('、') }} · 原档留在本机
      <button class="mt-1 block text-ink-faint underline" @click="ui.corruptedNotice = []">知道了</button>
    </p>

    <div class="flex gap-2">
      <button class="btn-ghost flex-1 !text-[12px]" :disabled="busy" @click="uploadNow">立即上传</button>
      <button class="btn-ghost flex-1 !text-[12px]" :disabled="busy" @click="pullConfirm = true">从云端恢复</button>
    </div>

    <BaseModal :open="pullConfirm" title="从云端恢复" @close="pullConfirm = false">
      <p class="text-[13px] leading-relaxed text-ink-soft">
        用<span class="text-cinnabar">云端存档覆盖本机</span>并重开游戏。本机尚未上传的进度会丢失;要保留就先「立即上传」。
      </p>
      <template #footer>
        <div class="flex gap-2">
          <button class="btn-ghost flex-1" :disabled="busy" @click="pullConfirm = false">取消</button>
          <button class="btn-seal flex-1" :disabled="busy" @click="confirmPull">确认恢复</button>
        </div>
      </template>
    </BaseModal>
  </div>
</template>

<script setup lang="ts">
  import { computed, onUnmounted, ref } from 'vue'
  import { useAuthStore } from '@/stores/auth'
  import { useGameStore } from '@/stores/game'
  import { useUiStore } from '@/stores/ui'
  import { formatDuration } from '@/utils/format'
  import { SAVE_VERSION, STORE_NAMES, saveWriteFailure, subscribeSaveWriteFailure } from '@/utils/storage'
  import { lastSyncAt, pullCloudSave, pushCloudSave, syncErrorText, syncState } from '@/core/cloudSave'
  import { API_BASE } from '@/services/cloud'
  import BaseModal from '@/components/common/BaseModal.vue'

  const game = useGameStore()
  const ui = useUiStore()
  const auth = useAuthStore()

  /** 自诊断:上传/恢复报异常时,先看是否同一道号、同一服务器 */
  const serverText = API_BASE === '' ? '本站同域' : API_BASE.replace(/^https?:\/\//, '')

  const saveFailed = ref(saveWriteFailure() !== null)
  /** 被隔离的分片(启动时 preflightScan 记下) */
  const corruptedNotice = computed<string[]>(() => ui.corruptedNotice)

  const busy = ref(false)
  const pullConfirm = ref(false)

  const syncTone = computed(() => {
    if (syncState.value === 'ok') return 'text-ink-faint'
    if (syncState.value === 'idle') return 'text-ink-faint'
    return 'text-cinnabar'
  })

  const syncText = computed(() => {
    if (syncState.value === 'ok') return lastSyncAt.value > 0 ? `正常 · ${formatWhen(lastSyncAt.value)}` : '正常'
    if (syncState.value === 'error') return `未同步 · ${syncErrorText.value}`
    if (syncState.value === 'conflict') return '已暂停'
    return '待同步'
  })

  const unsubscribeSaveFailure = subscribeSaveWriteFailure(failure => {
    saveFailed.value = failure !== null
  })

  onUnmounted(() => {
    unsubscribeSaveFailure()
  })

  function formatWhen(ts: number): string {
    const d = new Date(ts)
    const now = new Date()
    const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    return d.toDateString() === now.toDateString() ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`
  }

  async function uploadNow(): Promise<void> {
    busy.value = true
    const r = await pushCloudSave(true)
    busy.value = false
    const text =
      r === 'ok'
        ? '已上传到云端'
        : r === 'skipped-login'
          ? '尚未登录,请先登录再上传'
          : r === 'skipped-not-started'
            ? '本机尚未开局,没有进度可上传'
            : r === 'skipped-busy'
              ? '正在上传中,请稍候'
              : r === 'conflict'
                ? '云端已被其他设备更新,上传已暂停'
                : '上传失败,请稍后再试'
    ui.toast(text, r === 'ok' ? 'success' : 'warn')
  }

  async function confirmPull(): Promise<void> {
    pullConfirm.value = false
    busy.value = true
    try {
      const r = await pullCloudSave()
      if (r.status === 'applied') return
      ui.toast(
        r.status === 'error'
          ? `云端存档读取失败:${r.message}`
          : `云端还没有存档 · 账号 ${auth.username || '未登录'} @ ${serverText},确认与上传时同一道号、同一服务器`,
        'warn'
      )
    } catch {
      ui.toast('拉取失败，请检查网络', 'warn')
    }
    busy.value = false
  }

  // 只有在还没同步过时才主动推一次刷新状态:进设置页不该改变云端档(manual 上传会覆盖冲突保护)
  if (syncState.value === 'idle') void pushCloudSave()
</script>
