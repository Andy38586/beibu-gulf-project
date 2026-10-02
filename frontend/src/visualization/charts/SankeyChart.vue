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

/**
 * 最深一列（绘制在画布右边界）的节点名集合。
 *
 * 为什么要它：ECharts 桑基的节点标签默认画在节点**右侧**，末列节点贴着画布右边界 ⇒
 * 中文标签直接越界被裁（2026-10-02 实测：4×4 面板 320px 宽，"钦州港/防城港"这类末列
 * 标签看不见）。把末列标签翻到节点左侧即可留在画布内；其余列保持默认右侧。
 * 深度由 links 推（层数很浅，迭代到收敛，最多 3 层），不要求调用方额外传层级。
 */
function deepestNodeNames(): Set<string> {
  const depth = new Map<string, number>()
  for (const n of props.nodes) depth.set(n.name, 0)
  for (let i = 0; i < props.nodes.length; i++) {
    let changed = false
    for (const l of props.links) {
      const d = (depth.get(l.source) ?? 0) + 1
      if ((depth.get(l.target) ?? 0) < d) {
        depth.set(l.target, d)
        changed = true
      }
    }
    if (!changed) break
  }
  const max = Math.max(0, ...depth.values())
  return new Set(max === 0 ? [] : [...depth.entries()].filter(([, d]) => d === max).map(([n]) => n))
}

function getOption(): Record<string, unknown> {
  const dark = isDark.value
  const deepestNames = deepestNodeNames()
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
    // confine: true —— 与折线/柱状同款修复：html tooltip 会"躲视口边缘"逃出容器，
    // 而 4×4 面板是 overflow:hidden ⇒ 被裁（用户实测"分流分析也看不到"）。
    tooltip: { trigger: 'item', triggerOn: 'mousemove', confine: true },
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
        data: props.nodes.map((n) =>
          deepestNames.has(n.name) ? { ...n, label: { position: 'left' } } : n
        ),
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
