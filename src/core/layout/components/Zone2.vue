<script>
export default { name: 'GcsZone2' }
</script>

<script setup>
/**
 * Zone2 - 可视化区（左上）
 *
 * 职责：承载折线图、雷达图等可视化面板。
 * 通过 props 接收数据，与业务逻辑解耦，符合 Business → Data Contract → Visualization → Map 的架构契约。
 *
 * 数据契约（VisualizationDataContract）：
 * - input: { chartData: { labels: string[], series: { name: string, data: number[] }[] }, title?: string }
 * - output: { select: (index: number) => void }
 */

import GcsPanel from './GcsPanel.vue'
import LineChart from '@/visualization/charts/LineChart.vue'

defineProps({
  title: { type: String, default: '港口吞吐量趋势' },
  chartData: {
    type: Object,
    default: () => ({
      labels: ['2019', '2020', '2021', '2022', '2023', '2024'],
      series: [
        { name: '钦州港', data: [120, 132, 101, 134, 190, 230] },
        { name: '北海港', data: [90, 110, 120, 115, 140, 180] },
        { name: '防城港', data: [80, 95, 110, 125, 150, 170] },
      ],
    }),
  },
})

const emit = defineEmits(['select'])

function handleSelect(index) {
  // 将折线图的数据点索引透传给业务层
  emit('select', index)
}
</script>

<template>
  <GcsPanel :w="4" :h="4" class="zone-visualization">
    <LineChart
      class="zone-chart"
      :title="title"
      :x-data="chartData.labels"
      :series="chartData.series"
      @select="handleSelect"
    />
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
