<script setup lang="ts">
import { computed } from 'vue'

import { EmptyState } from '@/shared'

import { useChartBase } from './composables/useChartBase'

interface Props {
  title?: string
  xData?: string[]
  // data 允许 null（无数据空档，ECharts 原生支持），禁止调用方折叠为 0
  series?: Array<{ name: string; data: Array<number | null> }>
  xMin?: string
  xMax?: string
  /** y 轴单位（如「万吨」）；F4 起由 ForecastPage 从接口 unit 透传 */
  yUnit?: string
}

const props = withDefaults(defineProps<Props>(), {
  title: '港口吞吐量趋势',
  // 缺省为空：演示数据默认值会架空空态（漏传 series 的调用点静默显示虚构吞吐量）。
  // 数据一律由调用方显式传入；无数据走 EmptyState（F6）。
  xData: () => [],
  series: () => [],
  xMin: '',
  xMax: '',
  yUnit: '',
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
