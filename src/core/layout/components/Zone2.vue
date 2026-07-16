<script>
export default { name: 'GcsZone2' }
</script>

<script setup>
/**
 * Zone2 - 可视化区（左上）
 *
 * 职责：承载折线图、雷达图等可视化面板。
 * 当前阶段为占位实现，内部内容由后续 Phase 4 可视化组件替换。
 */

import GcsPanel from './GcsPanel.vue'
</script>

<template>
  <GcsPanel :w="4" :h="4" class="zone-visualization">
    <div class="zone-content">
      <span class="zone-label">可视化区</span>
    </div>
  </GcsPanel>
</template>

<style scoped>
.zone-visualization {
  width: 100%;
  height: 100%;
}

.zone-content {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.zone-label {
  font-size: 16px;
  font-weight: 500;
  opacity: 0.9;
}
</style>
