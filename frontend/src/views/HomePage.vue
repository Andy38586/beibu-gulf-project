<script setup lang="ts">
/**
 * HomePage - 首页
 * 职责：作为 Layout Base 的承载页面，渲染 GCS 四象限布局。
 * Phase 3-A 已接入 AppLayout；当前仅保留 InfoPanel 用于展示选中港口信息。
 * 港口吞吐量图表从 AppLayout 下沉到本页（业务数据由业务页持有）。
 */

import { computed, onMounted, ref } from 'vue'

import AppLayout from '@/core/layout/AppLayout.vue'
import GCSPanel from '@/core/layout/components/GCSPanel.vue'
import { logger, useApiRequest } from '@/shared'
import { useMapStore } from '@/stores'
import BarChart from '@/visualization/charts/BarChart.vue'
import LineChart from '@/visualization/charts/LineChart.vue'
import PortInfoPanel from '@/visualization/panels/PortInfoPanel.vue'

const mapStore = useMapStore()
const { apiRequest } = useApiRequest()

/**
 * 子组件 PortInfoPanel 的 props 声明为 Record<string, unknown>，
 * 而 selectedPort 实际是强类型的 Port。通过运行时类型守卫生成
 * 安全转换，移除裸 as unknown as，避免非法数据流入子组件模板。
 */
function isPortLike(data: unknown): data is Record<string, unknown> {
  return typeof data === 'object' && data !== null && !Array.isArray(data)
}

const selectedPortRecord = computed<Record<string, unknown> | undefined>(() => {
  const port = mapStore.selectedPort
  return isPortLike(port) ? port : undefined
})

/**
 * 折线图数据（首页默认展示，c023 从 AppLayout 下沉）
 * 2026-08-09（P0-2）：原硬编码 2019-2024 假数据 → onMounted 接
 * /forecast/timeseries?indicator=cargo&granularity=year（后端真实三港吞吐量，
 * 2021 起按年聚合）；接口失败图表留空，不回落假数据。
 */
const chartData = ref<{ labels: string[]; series: Array<{ name: string; data: number[] }> }>({
  labels: [],
  series: [],
})

/**
 * 柱状图数据（首页默认展示，c023 从 AppLayout 下沉）
 * 与折线图同源（charts 快照最近两年对比）。
 */
const barData = ref<{ labels: string[]; series: Array<{ name: string; data: number[] }> }>({
  labels: [],
  series: [],
})

/** /forecast/overview 返回的 charts 快照（预聚合年吞吐量，静态读盘零计算） */
interface OverviewCharts {
  indicator: string
  unit: string
  labels: string[]
  series: Array<{ name: string; data: number[] }>
}
interface OverviewResponse {
  metadata?: unknown
  charts?: OverviewCharts
}

async function loadOverviewCharts(): Promise<void> {
  try {
    // 2026-08-09（P0-2 + 用户定）：读 overview 的 charts 静态快照——
    // 不用 timeseries 接口（cargo.json 无 forecast 段会触发预测模型计算，首页不应跑预测）
    const res = await apiRequest<OverviewResponse>('forecast/overview')
    const charts = res.charts
    if (!charts || charts.series.length === 0) return
    chartData.value = {
      labels: charts.labels,
      series: charts.series,
    }
    // 柱状图：最近两年三港对比
    const recentYears = charts.labels.slice(-2)
    barData.value = {
      labels: charts.series.map((s) => s.name),
      series: recentYears.map((y) => ({
        name: `${y}年`,
        data: charts.series.map((s) => {
          const idx = charts.labels.indexOf(y)
          return idx >= 0 ? s.data[idx] ?? 0 : 0
        }),
      })),
    }
  } catch (error) {
    // 接口失败：图表留空（不回落硬编码假数据，避免上线假数据）
    logger.warn('[HomePage] 吞吐量图表数据加载失败:', error)
  }
}

onMounted(loadOverviewCharts)
</script>

<template>
  <div class="home-page">
    <AppLayout>
      <template #left>
        <!-- 左上：折线图 4×4 -->
        <GCSPanel :w="4" :h="4" anchor="top-left" :offset-x="0" :offset-y="1.25">
          <LineChart title="港口吞吐量趋势" :x-data="chartData.labels" :series="chartData.series" />
        </GCSPanel>
        <!-- 左下：柱状图 4×4 -->
        <GCSPanel :w="4" :h="4" anchor="top-left" :offset-x="0" :offset-y="5.5">
          <BarChart title="港口吞吐量对比" :x-data="barData.labels" :series="barData.series" />
        </GCSPanel>
      </template>
    </AppLayout>
    <PortInfoPanel v-if="mapStore.selectedPort" :selected-port="selectedPortRecord" />
  </div>
</template>

<style scoped>
.home-page {
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.home-page :deep(.info-panel) {
  pointer-events: auto;
}
</style>
