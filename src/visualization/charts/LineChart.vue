<script setup>
/**
 * LineChart - 折线图可视化组件
 *
 * 职责：基于 ECharts 渲染折线图，接收数据与标题配置。
 * 属于可视化资产（visualization/charts/），供所有业务复用。
 *
 * AUDIT-002(架构): 使用 useECharts composable 复用通用图表逻辑
 */

import { useECharts } from '@/visualization/composables/useECharts'

const props = defineProps({
  title: { type: String, default: '港口吞吐量趋势' },
  xData: { type: Array, default: () => ['2019', '2020', '2021', '2022', '2023', '2024'] },
  series: {
    type: Array,
    default: () => [
      { name: '钦州港', data: [120, 132, 101, 134, 190, 230] },
      { name: '北海港', data: [90, 110, 120, 115, 140, 180] },
      { name: '防城港', data: [80, 95, 110, 125, 150, 170] },
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
      textStyle: { color: '#333', fontSize: 14, fontWeight: 500 },
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
      type: 'line',
      smooth: true,
      data: s.data || [],
      symbol: 'circle',
      symbolSize: 6,
      lineStyle: { width: 2 },
      areaStyle: { opacity: 0.15 },
    })),
  }),
  watchSources: [() => props.title, () => props.xData, () => props.series],
  onClick: handleChartClick,
})
</script>

<template>
  <div ref="chartRef" class="line-chart"></div>
</template>

<style scoped>
.line-chart {
  width: 100%;
  height: 100%;
}
</style>
