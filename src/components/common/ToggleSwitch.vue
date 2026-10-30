<template>
  <button
    type="button"
    role="switch"
    :aria-checked="modelValue"
    :aria-label="label"
    class="relative h-6 w-11 shrink-0 rounded-full border transition-colors"
    :class="modelValue ? 'border-cinnabar bg-cinnabar' : 'border-ink/25 bg-ink/10'"
    @click="$emit('update:modelValue', !modelValue)"
  >
    <span
      class="absolute top-[2px] h-[18px] w-[18px] rounded-full border border-ink/20 bg-paper transition-all"
      :class="modelValue ? 'left-[22px]' : 'left-[2px]'"
    />
  </button>
</template>

<script setup lang="ts">
  /** 滑块开关:轨道 + 圆钮,开 = 朱砂填充;读屏按 switch 语义识别 */
  defineProps<{
    modelValue: boolean
    label?: string
  }>()

  defineEmits<{
    'update:modelValue': [boolean]
  }>()
</script>
