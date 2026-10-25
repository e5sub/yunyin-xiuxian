<template>
  <div class="card-ink space-y-2 px-4 py-3">
    <p class="text-[11px] leading-relaxed text-ink-faint">
      <template v-if="diag.errors.length">异常留档 {{ diag.errors.length }}/{{ DIAG_MAX }}</template>
      <template v-else>暂无记录</template>
    </p>
    <p v-if="latestError" class="rounded-md bg-ink/4 px-2 py-1.5 text-[10px] leading-relaxed text-ink-soft">
      <span class="tabular text-ink-faint">{{ formatClock(latestError.at) }}</span>
      <span v-if="latestError.count > 1" class="ml-1 text-ink-faint">×{{ latestError.count }}</span>
      <span class="ml-1 break-all">{{ latestError.message }}</span>
      <span v-if="latestError.route" class="ml-1 text-ink-faint">{{ latestError.route }}</span>
    </p>
    <div v-if="diag.errors.length" class="grid grid-cols-2 gap-2">
      <button class="btn-ghost !text-[12px]" @click="copyDiag">复制留档</button>
      <button class="btn-ghost !text-[12px]" @click="diag.clear()">清空留档</button>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import { useUiStore } from '@/stores/ui'
  import { DIAG_MAX, useDiagStore } from '@/stores/diag'
  import { formatClock } from '@/utils/format'

  const ui = useUiStore()
  const diag = useDiagStore()

  /** 只展示最近一条,其余随复制/导出带走 */
  const latestError = computed(() => diag.errors[diag.errors.length - 1] ?? null)

  const diagText = computed(() =>
    diag.errors
      .map(e => `${formatClock(e.at)} · ${e.info || '异常'} · ${e.message}${e.count > 1 ? ` ×${e.count}` : ''}${e.route ? ` @${e.route}` : ''}`)
      .join('\n')
  )

  async function copyDiag(): Promise<void> {
    try {
      await navigator.clipboard.writeText(diagText.value)
      ui.toast('已复制', 'success')
    } catch {
      // 剪贴板在非安全上下文(file:// 等)不可用;留档仍随「导出存档」带走
      ui.toast('复制失败', 'warn')
    }
  }
</script>
