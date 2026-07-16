<script setup>
/**
 * LineChart - 折线图可视化组件
 *
 * 职责：基于 ECharts 渲染折线图，接收数据与标题配置。
 * 属于可视化资产（visualization/charts/），供所有业务复用。
 */

import { ref, onMounted, onUnmounted, watch } from 'vue'
import * as echarts from 'echarts'

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

const chartRef = ref(null)
let chartInstance = null

function initChart() {
  if (!chartRef.value) return

  chartInstance = echarts.init(chartRef.value)
  updateOption()
  chartInstance.on('click', handleChartClick)

  window.addEventListener('resize', handleResize)
}

function updateOption() {
  if (!chartInstance) return

  const option = {
    backgroundColor: 'transparent',
    grid: { top: 40, right: 16, bottom: 24, left: 40 },
    title: {
      text: props.title,
      left: 'center',
      textStyle: { color: '#fff', fontSize: 14, fontWeight: 500 },
    },
    tooltip: { trigger: 'axis' },
    legend: {
      bottom: 0,
      textStyle: { color: 'rgba(255, 255, 255, 0.85)', fontSize: 10 },
      itemWidth: 10,
      itemHeight: 6,
    },
    xAxis: {
      type: 'category',
      data: props.xData,
      axisLine: { lineStyle: { color: 'rgba(255, 255, 255, 0.4)' } },
      axisLabel: { color: 'rgba(255, 255, 255, 0.8)', fontSize: 10 },
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: 'rgba(255, 255, 255, 0.15)' } },
      axisLabel: { color: 'rgba(255, 255, 255, 0.8)', fontSize: 10 },
    },
    series: props.series.map((s) => ({
      name: s.name,
      type: 'line',
      smooth: true,
      data: s.data,
      symbol: 'circle',
      symbolSize: 6,
      lineStyle: { width: 2 },
      areaStyle: { opacity: 0.15 },
    })),
  }

  chartInstance.setOption(option)
}

function handleChartClick(params) {
  // 当用户点击折线图的某个数据点时，向外抛出该点索引
  emit('select', params.dataIndex)
}

function handleResize() {
  chartInstance?.resize()
}

function disposeChart() {
  window.removeEventListener('resize', handleResize)
  chartInstance?.off('click', handleChartClick)
  chartInstance?.dispose()
  chartInstance = null
}

onMounted(initChart)
onUnmounted(disposeChart)

watch(() => [props.title, props.xData, props.series], updateOption, { deep: true })
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
