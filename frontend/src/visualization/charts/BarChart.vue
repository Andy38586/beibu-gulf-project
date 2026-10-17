<script setup lang="ts">
import { EmptyState } from '@/shared'

import { useChartBase } from './composables/useChartBase'

interface Props {
  title?: string
  xData?: string[]
  // data 允许 null（无数据空档，ECharts 原生支持），禁止调用方折叠为 0
  series?: Array<{ name: string; data: Array<number | null>; yAxisIndex?: number }>
  /** 左轴单位（如「万吨」）；F4 起由 ForecastPage 从接口 unit 透传 */
  yUnit?: string
  /** 右轴单位：传入时渲染双 Y 轴（不同量纲系列各占一轴） */
  yUnitRight?: string
}

const props = withDefaults(defineProps<Props>(), {
  title: '港口吞吐量对比',
  // 缺省为空：见 LineChart 同款口径（F6：演示数据默认值可架空空态）
  xData: () => [],
  series: () => [],
  yUnit: '',
  yUnitRight: '',
})

const emit = defineEmits<{
  select: [dataIndex: number]
}>()

/** 无数据时以 absolute 浮层显示空态；判定随 useChartBase 一并返回（chartRef 始终挂载） */
const { chartRef, hasData } = useChartBase(props, emit, 'bar', {
  barWidth: '30%',
  itemStyle: { borderRadius: [4, 4, 0, 0] },
})

defineExpose({ chartRef })
</script>

<template>
  <div class="bar-chart-container">
    <div ref="chartRef" class="bar-chart"></div>
    <EmptyState v-if="!hasData" class="bar-chart-empty" />
  </div>
</template>

<style scoped>
.bar-chart-container {
  position: relative;
  width: 100%;
  height: 100%;
}

.bar-chart {
  width: 100%;
  height: 100%;
}

.bar-chart-empty {
  position: absolute;
  inset: 0;
}
</style>
