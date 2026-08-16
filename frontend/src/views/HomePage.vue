<script setup lang="ts">
/**
 * HomePage - 首页
 * 承载 AppLayout 布局基座：左侧图表面板经 #left slot（Vue 插槽）注入；
 * 港口吞吐量图表下沉到本页（业务数据由业务页持有）。
 */

import { defineAsyncComponent, onMounted } from 'vue'

import { AppLayout, GCSPanel } from '@/core'
// 6-01：经 business 桶入口取数（不再深路径穿透 composables）
import { useOverviewCharts } from '@/business'
import { useMapStore } from '@/stores'
import { ChartLoading, PortInfoPanel } from '@/visualization'

// 图表异步化：echarts 移出首屏关键路径，就绪后替换 loading 占位。
// loader 保留深路径：懒加载走入口会把整个 visualization 桶打进主 chunk，
// 破坏拆分语义（Q4 收口仅约束静态跨层 import；动态 import 属构建优化，见 core/README 入口约定）
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
    <PortInfoPanel v-if="mapStore.selectedPort" :selected-port="mapStore.selectedPort" />
  </div>
</template>

<style scoped>
.home-page {
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.home-page :deep(.port-info-panel) {
  pointer-events: auto;
}
</style>
