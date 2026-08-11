<script setup lang="ts">
/**
 * DebugToggle - 独立调试模式开关（仅本地开发）
 * 固定右下角、不随响应式布局变化；Teleport 到 body（z-index 1100 与抽屉同级竞争）。
 * 显式 props/emits 而非 defineModel：Teleport 根的 defineModel 会失效。
 * 移除：删掉 AppLayout 中两处引用即完全脱离。
 */
import GCSButton from './GCSButton.vue'

const props = defineProps<{ modelValue?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

function toggle(): void {
  emit('update:modelValue', !props.modelValue)
}
</script>

<template>
  <Teleport to="body">
    <GCSButton
      :w="1"
      :h="1"
      label="调试"
      icon="🔍"
      :active="props.modelValue ?? false"
      class="debug-toggle"
      @click="toggle"
    />
  </Teleport>
</template>

<style scoped>
.debug-toggle {
  position: fixed;
  right: 16px;
  bottom: 88px;
  /* body 层 z-index：高于抽屉（1000）、低于 modal/toast 反馈层 */
  z-index: 1100;
  box-shadow: var(--GCS-shadow-md);
}
</style>
