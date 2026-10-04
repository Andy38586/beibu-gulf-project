<script setup lang="ts">
/**
 * 五准则雷达图面板（新选址，样式对齐旧版选址页的雷达面板）。
 *
 * 数据源与页面同一份 /site-suitability/map 响应（state.data）：取**得分最高的格子**
 * 作为展示对象（等价旧版"第一名小区"），五轴 = 五准则原始子分（0..1），底部一行综合得分。
 * 只读展示，不发请求、不写 store。
 *
 * ECharts 的雷达图组件不在 useECharts 的注册表里（那里只注册了折线/柱状），故本组件
 * 自行 echarts.use 一次性注册（与 SankeyChart 同款做法，全局幂等）。
 */
import { RadarChart } from 'echarts/charts'
import { TitleComponent, TooltipComponent } from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { computed } from 'vue'

import { CHART_COLORS, EmptyState, useTheme } from '@/shared'
import { useECharts } from '@/visualization'

import { CRITERIA } from '../constants/criteria'
import type { SiteSuitabilityPanelProps } from '../panelProps'

// 雷达图组件不在 useECharts 的注册表里（那里只注册折线/柱状），此处一次性补注册（全局幂等）。
echarts.use([RadarChart, TitleComponent, TooltipComponent, CanvasRenderer])

const props = withDefaults(defineProps<SiteSuitabilityPanelProps>(), { data: null, loading: false })

const { isDark } = useTheme()

/** 展示对象：得分最高的格子（同分保留响应原序首个） */
const peak = computed(() => {
  const features = props.data?.features ?? []
  let best: (typeof features)[number] | null = null
  for (const f of features) {
    const s = f.properties?.score
    if (typeof s !== 'number' || !Number.isFinite(s)) continue
    if (!best || s > best.properties.score) best = f
  }
  return best
})

/** 五准则轴序与取值（缺字段按 0，不臆造） */
const values = computed(() =>
  CRITERIA.map((c) => {
    const v = peak.value?.properties?.[c.key]
    return typeof v === 'number' && Number.isFinite(v) ? v : 0
  })
)

const scoreText = computed(() => (peak.value ? peak.value.properties.score.toFixed(3) : '—'))

function getOption(): Record<string, unknown> {
  const dark = isDark.value
  const text = dark ? CHART_COLORS.textPrimary.dark : CHART_COLORS.textPrimary.light
  const gridColor = dark ? 'rgba(255,255,255,.18)' : 'rgba(0,0,0,.12)'
  const muted = dark ? CHART_COLORS.textSecondary.dark : CHART_COLORS.textSecondary.light
  return {
    backgroundColor: 'transparent',
    title: {
      text: '最高分格子 · 五准则画像',
      left: 'center',
      textStyle: { color: text, fontSize: 16, fontWeight: 600 },
    },
    tooltip: {
      trigger: 'item',
      // 与图表基座同款：4×4 面板 overflow:hidden，未约束的 html tooltip 会被裁
      confine: true,
      valueFormatter: (v: number) => (typeof v === 'number' ? v.toFixed(3) : String(v)),
    },
    radar: {
      center: ['50%', '56%'],
      radius: '62%',
      indicator: CRITERIA.map((c) => ({ name: c.label, max: 1 })),
      axisName: { color: muted, fontSize: 10 },
      splitLine: { lineStyle: { color: gridColor } },
      splitArea: { show: false },
      axisLine: { lineStyle: { color: gridColor } },
    },
    series: [
      {
        type: 'radar',
        symbolSize: 4,
        data: [{ value: values.value, name: '准则子分' }],
        areaStyle: { opacity: 0.25 },
        lineStyle: { width: 2 },
      },
    ],
  }
}

// 容器用 v-if（有数据才挂载）：useECharts 的 init 是幂等的、且带 ResizeObserver，
// 正是为 v-if 场景设计的用法；早前用 v-show + 手工 echarts.init 会按 0 尺寸初始化成空白图。
const { chartRef } = useECharts({
  getOption,
  watchSources: [() => props.data, isDark],
  recomputeOptionOnResize: true,
})

defineExpose({ chartRef, peak })
</script>

<template>
  <div class="suit-radar-panel">
    <div v-if="peak" ref="chartRef" class="suit-radar-chart" />
    <div v-if="peak" class="suit-radar-score">
      综合得分 <strong>{{ scoreText }}</strong>
    </div>
    <div v-else-if="!loading" class="suit-radar-empty">
      <EmptyState message="暂无数据" />
    </div>
    <div v-else class="suit-radar-empty">计算中…</div>
  </div>
</template>

<style scoped>
.suit-radar-panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
}

.suit-radar-chart {
  flex: 1;
  min-height: 0;
}

/* 底部综合评分行：与面板标题同字号档，弱化标签、强调数值 */
.suit-radar-score {
  flex-shrink: 0;
  text-align: center;
  font-size: 12px;
  color: var(--GCS-text-secondary);
  padding: 2px 0 4px;
}

.suit-radar-score strong {
  color: var(--GCS-text-primary);
  font-size: 14px;
}

.suit-radar-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--GCS-text-secondary);
}
</style>
