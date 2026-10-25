<script setup lang="ts">
// 桑基图（分流分析 W10-11）：ECharts Sankey 需单独注册（useECharts 只注册
// Line/Bar）——本组件内 echarts.use 一次性注册，全局幂等。
// 生命周期/resize/主题响应收敛 useECharts（D19：原手写版丢 ResizeObserver、
// resize 只 setOption 不调 instance.resize ⇒ canvas 不随窗口重设，疑似真 bug 已修）。
// 主题色走 chartColor('textPrimary')（W67 收口）：原 #e5eaf3 与 CHART_COLORS.textPrimary.dark
// （#e8edf4）是近失字面量，已并入单源；暗色标签因此有 ≤5 阶的观感微调（非布局变更）。
// Cesium ③ A3：节点/边点击经 bindSankeyClick 转发 sankey-click（载荷形态见 sankeyClick.ts），
// 注销与注册同作用域（onUnmounted 调解绑器）。
import { SankeyChart } from 'echarts/charts'
import { LegendComponent, TitleComponent, TooltipComponent } from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { onMounted, onUnmounted, ref } from 'vue'

import { chartColor, useTheme } from '@/shared'

import { chartTitleOption } from '@/visualization/charts/chartTheme'
import { useECharts } from '@/visualization/composables/useECharts'
import { bindSankeyClick, type SankeyClickPayload } from './sankeyClick'

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

const emit = defineEmits<{ (e: 'sankey-click', payload: SankeyClickPayload): void }>()

const props = withDefaults(defineProps<Props>(), { title: '西江货类转移流向' })

const { isDark } = useTheme()

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
    title: chartTitleOption(props.title, dark),
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
        label: { color: chartColor('textPrimary', dark), fontSize: 12 },
        lineStyle: { color: 'gradient', curveness: 0.5, opacity: 0.35 },
        data: props.nodes.map((n) =>
          deepestNames.has(n.name) ? { ...n, label: { position: 'left' } } : n
        ),
        links: props.links,
      },
    ],
  }
}

// D19：生命周期/更新/resize（window + ResizeObserver）/主题响应全部收敛 useECharts；
// merge 口径（notMerge:false + replaceMerge:['series'] + lazyUpdate）与原手写版逐字一致。
const chartRef = ref<HTMLElement | null>(null)
const { getInstance } = useECharts({
  getOption,
  watchSources: [() => props.nodes, () => props.links],
  chartRef,
})

let disposeClick: (() => void) | null = null

onMounted(() => {
  // useECharts 的 onMounted（initChart）先于本组件 onMounted 注册 ⇒ getInstance 必已就绪
  const inst = getInstance()
  if (inst) {
    // 点击→emit（A3 桑基联动）；解绑器与注册同作用域，unmount 时注销（禁忌 4）
    disposeClick = bindSankeyClick(inst, (payload) => emit('sankey-click', payload))
  }
})

onUnmounted(() => {
  disposeClick?.()
  disposeClick = null
})
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
