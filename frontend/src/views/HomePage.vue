<script setup lang="ts">
/**
 * HomePage - 首页
 * 承载 AppLayout 布局基座：左侧图表面板经 #left slot（Vue 插槽）注入；
 * 港口吞吐量图表下沉到本页（业务数据由业务页持有）。
 */

import { defineAsyncComponent, onMounted } from 'vue'

// 6-01：经 business 桶入口取数（不再深路径穿透 composables）
import { useOverviewCharts } from '@/business'
import { AppLayout, GCSPanel } from '@/core'
import { ChartLoading } from '@/visualization'

// 图表异步化：echarts 移出首屏关键路径，就绪后替换 loading 占位。
// loader 保留深路径：懒加载走入口会把整个 visualization 桶打进主 chunk，
// 破坏拆分语义（入口仅约束静态跨层 import；动态 import 属构建优化，见 core/README 入口约定）
const LineChart = defineAsyncComponent({
  loader: () => import('@/visualization/charts/LineChart.vue'),
  loadingComponent: ChartLoading,
})
const BarChart = defineAsyncComponent({
  loader: () => import('@/visualization/charts/BarChart.vue'),
  loadingComponent: ChartLoading,
})

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
    <!-- 港口信息浮层（PortInfoPanel）已移除：点击/悬浮港口改由地图内气泡（MapFeatureBubble）呈现 -->
  </div>
</template>

<style scoped>
.home-page {
  width: 100%;
  height: 100%;
  pointer-events: none;
}
</style>
