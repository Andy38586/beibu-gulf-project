<script>
export default { name: 'GcsZone2' }
</script>

<script setup>
/**
 * Zone2 - 可视化区（左上）
 *
 * 职责：承载折线图、雷达图等可视化面板。
 * Phase 3-B：接入 LineChart 折线图占位，后续 Phase 4 替换为业务真实数据。
 */

import GcsPanel from './GcsPanel.vue'
import LineChart from './charts/LineChart.vue'
</script>

<template>
  <GcsPanel :w="4" :h="4" class="zone-visualization">
    <LineChart class="zone-chart" />
  </GcsPanel>
</template>

<style scoped>
.zone-visualization {
  width: 100%;
  height: 100%;
}

.zone-chart {
  width: 100%;
  height: 100%;
}
</style>
