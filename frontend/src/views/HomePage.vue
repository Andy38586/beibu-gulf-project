<script setup lang="ts">
/**
 * HomePage - 首页
 * 承载 AppLayout 布局基座：左侧图表面板经 #left slot（Vue 插槽）注入；
 * 港口吞吐量图表下沉到本页（业务数据由业务页持有）。
 */

import { computed, defineAsyncComponent, onMounted } from 'vue'

import AppLayout from '@/core/layout/AppLayout.vue'
import GCSPanel from '@/core/layout/components/GCSPanel.vue'
import { useOverviewCharts } from '@/business/forecast/composables/useOverviewCharts'
import { useMapStore } from '@/stores'
import ChartLoading from '@/visualization/charts/ChartLoading.vue'
import PortInfoPanel from '@/visualization/panels/PortInfoPanel.vue'

// 图表异步化：echarts 移出首屏关键路径，就绪后替换 loading 占位
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

/** 类型守卫：强类型 Port 安全转成子组件所需的 Record<string, unknown>，避免裸断言 */
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
