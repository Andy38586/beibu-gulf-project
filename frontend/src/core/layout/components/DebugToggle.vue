<script setup lang="ts">
/**
 * DebugToggle - 独立调试模式开关（2026-08-09 用户决策）
 * - 从底部 nav dock 移出：dock 只承载业务导航 + 抽屉菜单按钮（业务侧零调试依赖）
 * - 独立板块：固定右下角，不跟随响应式布局变化（桌面/抽屉档位均渲染）
 * - 1×1 cell 方块（GCSButton），与 dock 内 0.8×0.8 按钮区分
 * - 移除方式：删掉 AppLayout 中 <DebugToggle> 与 <GCSDebugOverlay> 两处引用即完全脱离
 */
import GCSButton from './GCSButton.vue'

const debugMode = defineModel<boolean>('debugMode', { default: false })
</script>

<template>
  <GCSButton
    :w="1"
    :h="1"
    label="调试"
    icon="🔍"
    :active="debugMode"
    class="debug-toggle"
    @click="debugMode = !debugMode"
  />
</template>

<style scoped>
.debug-toggle {
  position: fixed;
  right: 16px;
  bottom: 88px;
  z-index: 70;
  box-shadow: var(--GCS-shadow-md);
}
</style>
