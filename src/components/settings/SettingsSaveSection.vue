<template>
  <div class="card-ink space-y-2 px-4 py-3">
    <p class="text-[11px] text-ink-faint tabular">
      存档版本 v{{ SAVE_VERSION }} · 修行时长 {{ formatDuration(game.totalPlaySec) }}
    </p>
    <p class="text-[11px] tabular" :class="syncError ? 'text-cinnabar' : 'text-ink-faint'">
      云同步 {{ syncText }}
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
    <button class="btn-ghost w-full !border-cinnabar/40 !text-[12px] !text-cinnabar" @click="openReset">
      清空存档
    </button>

    <BaseModal :open="resetConfirm" title="清空存档" @close="closeReset">
      <p class="text-[13px] leading-relaxed text-ink-soft">
        <span class="text-cinnabar">清空</span>本机与云端存档 · 含转世收获 · 不可逆
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
  import { pushCloudSave } from '@/core/cloudSave'
  import { cloudApi } from '@/services/cloud'
  import BaseModal from '@/components/common/BaseModal.vue'

  const game = useGameStore()
  const ui = useUiStore()

  const saveFailed = ref(saveWriteFailure() !== null)
  /** 被隔离的分片(启动时 preflightScan 记下) */
  const corruptedNotice = computed<string[]>(() => ui.corruptedNotice)

  /** 云同步状态:一次推送成败翻一次 */
  const syncError = ref(false)
  const syncText = computed(() => (syncError.value ? '未同步' : '正常'))

  const resetConfirm = ref(false)

  const unsubscribeSaveFailure = subscribeSaveWriteFailure(failure => {
    saveFailed.value = failure !== null
  })

  onUnmounted(() => {
    unsubscribeSaveFailure()
    if (resetConfirm.value) engine.resume()
  })

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

  // 进设置页推一次,让「云同步」状态有据可依
  void pushCloudSave().then(ok => {
    syncError.value = !ok
  })
</script>
