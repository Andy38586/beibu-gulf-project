<script>
export default { name: 'GcsZone4' }
</script>

<script setup>
/**
 * Zone4 - 结果展示区（右下）
 *
 * 职责：承载业务结果、配置面板等内容。
 * 首页默认不显示内容，业务路由（如 SiteSelection）在此挂载业务面板。
 * 当前阶段为占位实现。
 */

import GcsPanel from './GcsPanel.vue'
</script>

<template>
  <GcsPanel :w="4" :h="4" class="zone-result">
    <div class="zone-content">
      <span class="zone-label">结果展示区</span>
    </div>
  </GcsPanel>
</template>

<style scoped>
.zone-result {
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
