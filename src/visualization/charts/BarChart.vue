<script setup>
/**
 * BarChart - 柱状图可视化组件
 *
 * 职责：基于 ECharts 渲染柱状图，接收数据与标题配置。
 * 属于可视化资产（visualization/charts/），供所有业务复用。
 */

import { ref, onMounted, onUnmounted, watch } from 'vue'
import * as echarts from 'echarts/core'
import { BarChart } from 'echarts/charts'
import {
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  GridComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([
  BarChart,
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  GridComponent,
  CanvasRenderer,
])

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
      data: props.xData,
      axisLine: { lineStyle: { color: '#ddd' } },
      axisLabel: { color: '#666', fontSize: 10 },
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: '#eee' } },
      axisLabel: { color: '#666', fontSize: 10 },
    },
    series: props.series.map((s) => ({
      name: s.name,
      type: 'bar',
      data: s.data,
      barWidth: '30%',
      itemStyle: { borderRadius: [4, 4, 0, 0] },
    })),
  }

  chartInstance.setOption(option)
}

function handleChartClick(params) {
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
  <div ref="chartRef" class="bar-chart"></div>
</template>

<style scoped>
.bar-chart {
  width: 100%;
  height: 100%;
}
</style>
