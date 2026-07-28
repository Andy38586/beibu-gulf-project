<script setup lang="ts">
/**
 * HomePage - 首页
 *
 * 职责：作为 Layout Base 的承载页面，渲染 GCS 四象限布局。
 * Phase 3-A 已接入 AppLayout；当前仅保留 InfoPanel 用于展示选中港口信息。
 */

import AppLayout from '@/core/layout/AppLayout.vue'
import PortInfoPanel from '@/visualization/panels/PortInfoPanel.vue'
import { useMapStore } from '@/stores/mapStore'

const mapStore = useMapStore()
</script>

<template>
  <div class="home-page">
    <AppLayout />
    <PortInfoPanel
      v-if="mapStore.selectedPort"
      :selectedPort="mapStore.selectedPort as unknown as Record<string, unknown>"
    />
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
