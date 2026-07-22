<script setup>
/**
 * BarChart - 柱状图可视化组件
 *
 * 职责：基于 ECharts 渲染柱状图，接收数据与标题配置。
 * 属于可视化资产（visualization/charts/），供所有业务复用。
 *
 * AUDIT-002(架构): 使用 useECharts composable 复用通用图表逻辑
 */

import { useECharts } from '@/visualization/composables/useECharts'

const props = defineProps({
  title: { type: String, default: '港口吞吐量对比' },
  xData: { type: Array, default: () => ['钦州港', '北海港', '防城港'] },
  series: {
    type: Array,
    default: () => [
      { name: '2023年', data: [190, 140, 150] },
      { name: '2024年', data: [230, 180, 170] },
    ],
  },
})

const emit = defineEmits(['select'])

/** AUDIT-117: 边界场景处理 - 空数据保护 */
function handleChartClick(params) {
  if (params.dataIndex == null) return
  emit('select', params.dataIndex)
}

const { chartRef } = useECharts({
  getOption: () => ({
    backgroundColor: 'transparent',
    grid: { top: 40, right: 16, bottom: 40, left: 40 },
    title: {
      text: props.title,
      left: 'center',
      textStyle: { color: '#303133', fontSize: 16, fontWeight: 600 },
    },
    tooltip: { trigger: 'axis' },
    legend: {
      bottom: 0,
      textStyle: { color: '#666', fontSize: 10 },
      itemWidth: 10,
      itemHeight: 6,
    },
    xAxis: {
      type: 'category',
      data: props.xData || [],
      axisLine: { lineStyle: { color: '#ddd' } },
      axisLabel: { color: '#666', fontSize: 10 },
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: '#eee' } },
      axisLabel: { color: '#666', fontSize: 10 },
    },
    series: (props.series || []).map((s) => ({
      name: s.name,
      type: 'bar',
      data: s.data || [],
      barWidth: '30%',
      itemStyle: { borderRadius: [4, 4, 0, 0] },
    })),
  }),
  watchSources: [() => props.title, () => props.xData, () => props.series],
  onClick: handleChartClick,
})
</script>

<template>
  <div ref="chartRef" class="bar-chart"></div>
</template>

<style scoped>
.bar-chart {
  width: 100%;
  height: 100%;
}
</style>
