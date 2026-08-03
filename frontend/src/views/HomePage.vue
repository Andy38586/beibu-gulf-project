<script setup lang="ts">
/**
 * HomePage - 首页
 *
 * 职责：作为 Layout Base 的承载页面，渲染 GCS 四象限布局。
 * Phase 3-A 已接入 AppLayout；当前仅保留 InfoPanel 用于展示选中港口信息。
 */

import { computed } from 'vue'

import AppLayout from '@/core/layout/AppLayout.vue'
import { useMapStore } from '@/stores'
import PortInfoPanel from '@/visualization/panels/PortInfoPanel.vue'

const mapStore = useMapStore()

/**
 * 子组件 PortInfoPanel 的 props 声明为 Record<string, unknown>，
 * 而 selectedPort 实际是强类型的 Port。通过运行时类型守卫生成
 * 安全转换，移除裸 as unknown as，避免非法数据流入子组件模板。
 */
function isPortLike(data: unknown): data is Record<string, unknown> {
  return typeof data === 'object' && data !== null && !Array.isArray(data)
}

const selectedPortRecord = computed<Record<string, unknown> | undefined>(() => {
  const port = mapStore.selectedPort
  return isPortLike(port) ? port : undefined
})
</script>

<template>
  <div class="home-page">
    <AppLayout />
    <PortInfoPanel v-if="mapStore.selectedPort" :selected-port="selectedPortRecord" />
  </div>
</template>

<style scoped>
.home-page {
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.home-page :deep(.info-panel) {
  pointer-events: auto;
}
</style>
