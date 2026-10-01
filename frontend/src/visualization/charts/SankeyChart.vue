<script setup lang="ts">
// 桑基图（分流分析 W10-11）：ECharts Sankey 需单独注册（useECharts 只注册了
// Line/Bar）——本组件内 echarts.use 一次性注册，全局幂等。
import type { ECharts } from 'echarts'
import { SankeyChart } from 'echarts/charts'
import { LegendComponent, TitleComponent, TooltipComponent } from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import type { Ref, WatchSource } from 'vue'
import { onMounted, onUnmounted, ref, watch } from 'vue'

import { useTheme } from '@/shared'

echarts.use([SankeyChart, TitleComponent, TooltipComponent, LegendComponent, CanvasRenderer])

export interface SankeyNode {
  name: string
}

export interface SankeyLink {
  source: string
  target: string
  value: number
}

interface Props {
  title?: string
  nodes: SankeyNode[]
  links: SankeyLink[]
}

const props = withDefaults(defineProps<Props>(), { title: '西江货类转移流向' })

const { isDark } = useTheme()
const chartRef = ref<HTMLElement | null>(null)
let instance: ECharts | null = null

function getOption(): Record<string, unknown> {
  const dark = isDark.value
  return {
    backgroundColor: 'transparent',
    title: {
      text: props.title,
      left: 'center',
      textStyle: {
        color: dark ? '#e5eaf3' : '#303133',
        fontSize: 16,
        fontWeight: 600,
      },
    },
    tooltip: { trigger: 'item', triggerOn: 'mousemove' },
    series: [
      {
        type: 'sankey',
        layout: 'none',
        top: 40,
        bottom: 20,
        emphasis: { focus: 'adjacency' },
        nodeGap: 14,
        nodeWidth: 18,
        label: { color: dark ? '#e5eaf3' : '#303133', fontSize: 12 },
        lineStyle: { color: 'gradient', curveness: 0.5, opacity: 0.35 },
        data: props.nodes,
        links: props.links,
      },
    ],
  }
}

function updateChart(): void {
  instance?.setOption(getOption(), true)
}

onMounted(() => {
  if (!chartRef.value) return
  instance = echarts.init(chartRef.value)
  updateChart()
  // 主题/数据变化重渲染；容器尺寸变化由 echarts 内置 resize 监听
  watch([() => props.nodes, () => props.links, isDark] as WatchSource<unknown>[], updateChart)
  window.addEventListener('resize', updateChart)
})

onUnmounted(() => {
  window.removeEventListener('resize', updateChart)
  instance?.dispose()
  instance = null
})

defineExpose({ chartRef: chartRef as Ref<HTMLElement | null>, updateChart })
</script>

<template>
  <div ref="chartRef" class="sankey-chart" />
</template>

<style scoped>
.sankey-chart {
  width: 100%;
  height: 100%;
  min-height: 240px;
}
</style>
