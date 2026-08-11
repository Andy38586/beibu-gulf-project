<script setup lang="ts">
import { computed } from 'vue'

import EmptyState from '@/shared/components/EmptyState.vue'

import { useChartBase } from './composables/useChartBase'

interface Props {
  title?: string
  xData?: string[]
  series?: Array<{ name: string; data: number[] }>
  xMin?: string
  xMax?: string
}

const props = withDefaults(defineProps<Props>(), {
  title: '港口吞吐量趋势',
  xData: () => ['2019', '2020', '2021', '2022', '2023', '2024'],
  series: () => [
    { name: '钦州港', data: [120, 132, 101, 134, 190, 230] },
    { name: '北海港', data: [90, 110, 120, 115, 140, 180] },
    { name: '防城港', data: [80, 95, 110, 125, 150, 170] },
  ],
  xMin: '',
  xMax: '',
})

const emit = defineEmits<{
  select: [dataIndex: number]
}>()

const { chartRef } = useChartBase(props, emit, 'line', {
  smooth: true,
  symbol: 'circle',
  symbolSize: 6,
  lineStyle: { width: 2 },
  areaStyle: { opacity: 0.15 },
})

/** 无数据时以 absolute 浮层显示空态（chartRef 始终挂载） */
const hasData = computed(() => {
  if (!props.series || props.series.length === 0) return false
  return props.series.some((s) => s.data && s.data.length > 0)
})

defineExpose({ chartRef })
</script>

<template>
  <div class="line-chart-container">
    <div ref="chartRef" class="line-chart"></div>
    <EmptyState v-if="!hasData" class="line-chart-empty" />
  </div>
</template>

<style scoped>
.line-chart-container {
  position: relative;
  width: 100%;
  height: 100%;
}

.line-chart {
  width: 100%;
  height: 100%;
}

.line-chart-empty {
  position: absolute;
  inset: 0;
}
</style>
