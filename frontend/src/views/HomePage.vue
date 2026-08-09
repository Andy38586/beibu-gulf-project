<script setup lang="ts">
/**
 * HomePage - 首页
 * 职责：作为 Layout Base 的承载页面，渲染 GCS 四象限布局。
 * Phase 3-A 已接入 AppLayout；当前仅保留 InfoPanel 用于展示选中港口信息。
 * 港口吞吐量图表从 AppLayout 下沉到本页（业务数据由业务页持有）。
 */

import { computed, defineAsyncComponent, onMounted } from 'vue'

import AppLayout from '@/core/layout/AppLayout.vue'
import GCSPanel from '@/core/layout/components/GCSPanel.vue'
import { useOverviewCharts } from '@/shared'
import { useMapStore } from '@/stores'
import ChartLoading from '@/visualization/charts/ChartLoading.vue'
import PortInfoPanel from '@/visualization/panels/PortInfoPanel.vue'

// 2026-08-09：图表组件异步化——echarts（~537KB raw）移出首屏关键路径，
// 首页地图先出，图表块就绪后替换 loading 占位（预测页本就路由懒加载）
const LineChart = defineAsyncComponent({
  loader: () => import('@/visualization/charts/LineChart.vue'),
  loadingComponent: ChartLoading,
})
const BarChart = defineAsyncComponent({
  loader: () => import('@/visualization/charts/BarChart.vue'),
  loadingComponent: ChartLoading,
})

const mapStore = useMapStore()
const { chartData, barData, loadOverviewCharts } = useOverviewCharts()

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
