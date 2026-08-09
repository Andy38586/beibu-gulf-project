<script setup lang="ts">
/**
 * DebugToggle - 独立调试模式开关（2026-08-09 用户决策）
 * - 从底部 nav dock 移出：dock 只承载业务导航 + 抽屉菜单按钮（业务侧零调试依赖）
 * - 独立板块：固定右下角，不跟随响应式布局变化（桌面/抽屉档位均渲染）
 * - 1×1 cell 方块（GCSButton），与 dock 内 0.8×0.8 按钮区分
 * - Teleport 到 body：脱离 .app-layout（z-index:50 的 stacking context），
 *   z-index 1100 才能与抽屉（body 层 1000）同级竞争
 * - 显式 props/emits 而非 defineModel：Teleport 根的组件 defineModel 失效
 *   （modelValue 成为未声明 attrs，v-model 链路断裂，2026-08-09 实测）
 * - 移除方式：删掉 AppLayout 中 <DebugToggle> 与 <GCSDebugOverlay> 两处引用即完全脱离
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
