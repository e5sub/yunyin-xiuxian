<template>
  <div class="card-ink space-y-2 px-4 py-3">
    <p class="text-[11px] text-ink-faint tabular">
      存档版本 v{{ SAVE_VERSION }} · 修行时长 {{ formatDuration(game.totalPlaySec) }}
    </p>
    <p class="text-[11px] tabular" :class="syncTone">云同步 {{ syncText }}</p>
    <p
      v-if="syncState === 'conflict'"
      class="rounded-md border border-cinnabar/40 bg-cinnabar/8 px-2 py-1.5 text-[11px] leading-relaxed text-cinnabar"
    >
      云端存档被其他设备更新过，本机已暂停上传以免覆盖。以哪边为准请自行选择：本机进度更新就「立即上传」，否则「从云端恢复」。
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
    <button class="btn-ghost w-full !text-[12px]" :disabled="busy" @click="toggleHistory">
      {{ historyOpen ? '收起历史版本' : '历史版本' }}
    </button>
    <ul v-if="historyOpen" class="space-y-1">
      <li v-if="history.length === 0" class="text-[11px] text-ink-faint">暂无历史版本（每次覆盖云端前自动留档）</li>
      <li
        v-for="h in history"
        :key="h.id"
        class="flex items-center justify-between gap-2 text-[11px] tabular text-ink-soft"
      >
        <span class="truncate">
          {{ formatWhen(h.created_at) }} · {{ realmLabel(Math.floor(h.realm_index / 100), h.realm_index % 100) }} ·
          {{ Math.max(1, Math.round(h.size / 1024)) }}KB
        </span>
        <button class="shrink-0 text-cinnabar underline" @click="rollbackTarget = h">回滚</button>
      </li>
    </ul>

    <button class="btn-ghost w-full !border-cinnabar/40 !text-[12px] !text-cinnabar" @click="openReset">
      清空存档
    </button>

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

    <BaseModal :open="rollbackTarget !== null" title="回滚存档" @close="rollbackTarget = null">
      <p class="text-[13px] leading-relaxed text-ink-soft">
        回滚到
        <span class="text-ink">{{ rollbackTarget === null ? '' : formatWhen(rollbackTarget.created_at) }}</span>
        的存档。当前云端档会先存一份历史,回滚后仍可再回滚回来。
      </p>
      <template #footer>
        <div class="flex gap-2">
          <button class="btn-ghost flex-1" :disabled="busy" @click="rollbackTarget = null">取消</button>
          <button class="btn-seal flex-1" :disabled="busy" @click="confirmRollback">确认回滚</button>
        </div>
      </template>
    </BaseModal>

    <BaseModal :open="resetConfirm" title="清空存档" @close="closeReset">
      <p class="text-[13px] leading-relaxed text-ink-soft">
        清空本机<span class="text-cinnabar">与云端</span>存档 · 含转世收获 · 不可逆
      </p>
      <template #footer>
        <div class="flex gap-2">
          <button class="btn-ghost flex-1" @click="closeReset">再想想</button>
          <button class="btn-seal flex-1 !bg-cinnabar-deep" @click="confirmReset">确认清空</button>
        </div>
      </template>
    </BaseModal>
  </div>
</template>

<script setup lang="ts">
  import { computed, onUnmounted, ref } from 'vue'
  import { useGameStore } from '@/stores/game'
  import { useUiStore } from '@/stores/ui'
  import { resetGame } from '@/core/save'
  import { engine } from '@/core/engine'
  import { formatDuration } from '@/utils/format'
  import { SAVE_VERSION, STORE_NAMES, saveWriteFailure, subscribeSaveWriteFailure } from '@/utils/storage'
  import { lastSyncAt, pullCloudSave, pushCloudSave, syncErrorText, syncState } from '@/core/cloudSave'
  import { cloudApi, type SaveHistoryRow } from '@/services/cloud'
  import { realmLabel } from '@/data/realms'
  import BaseModal from '@/components/common/BaseModal.vue'

  const game = useGameStore()
  const ui = useUiStore()

  const saveFailed = ref(saveWriteFailure() !== null)
  /** 被隔离的分片(启动时 preflightScan 记下) */
  const corruptedNotice = computed<string[]>(() => ui.corruptedNotice)

  const busy = ref(false)
  const resetConfirm = ref(false)
  const pullConfirm = ref(false)
  const historyOpen = ref(false)
  const history = ref<SaveHistoryRow[]>([])
  const rollbackTarget = ref<SaveHistoryRow | null>(null)

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
    if (resetConfirm.value) engine.resume()
  })

  function formatWhen(ts: number): string {
    const d = new Date(ts)
    const now = new Date()
    const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    return d.toDateString() === now.toDateString() ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`
  }

  async function uploadNow(): Promise<void> {
    busy.value = true
    const ok = await pushCloudSave(true)
    busy.value = false
    ui.toast(ok ? '已上传到云端' : '上传失败，请稍后再试', ok ? 'success' : 'warn')
  }

  async function confirmPull(): Promise<void> {
    pullConfirm.value = false
    busy.value = true
    try {
      const r = await pullCloudSave()
      if (r.status === 'applied') return
      ui.toast(r.status === 'error' ? `云端存档读取失败:${r.message}` : '云端还没有存档', 'warn')
    } catch {
      ui.toast('拉取失败，请检查网络', 'warn')
    }
    busy.value = false
  }

  async function toggleHistory(): Promise<void> {
    historyOpen.value = !historyOpen.value
    if (!historyOpen.value) return
    try {
      history.value = (await cloudApi.saveHistory(30)).history
    } catch {
      ui.toast('历史版本读取失败', 'warn')
    }
  }

  async function confirmRollback(): Promise<void> {
    const target = rollbackTarget.value
    if (target === null) return
    rollbackTarget.value = null
    busy.value = true
    try {
      await cloudApi.restoreSave(target.id)
      const r = await pullCloudSave()
      if (r.status !== 'applied') ui.toast('回滚已写入云端，重开游戏后生效', 'warn')
    } catch {
      ui.toast('回滚失败', 'warn')
    }
    busy.value = false
  }

  function openReset(): void {
    resetConfirm.value = true
    engine.pause()
  }

  function closeReset(): void {
    resetConfirm.value = false
    engine.resume()
  }

  function confirmReset(): void {
    // 云端档一并清掉,否则重登会把云档拉回来
    cloudApi.deleteSave().catch(() => undefined)
    resetGame()
  }

  // 只有在还没同步过时才主动推一次刷新状态:进设置页不该改变云端档(manual 上传会覆盖冲突保护)
  if (syncState.value === 'idle') void pushCloudSave()
</script>
