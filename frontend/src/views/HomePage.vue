<script setup lang="ts">
/**
 * HomePage - 首页
 *
 * 职责：作为 Layout Base 的承载页面，渲染 GCS 四象限布局。
 * Phase 3-A 已接入 AppLayout；当前仅保留 InfoPanel 用于展示选中港口信息。
 * c023：港口吞吐量图表从 AppLayout 下沉到本页（业务数据由业务页持有）。
 */

import { computed } from 'vue'

import AppLayout from '@/core/layout/AppLayout.vue'
import GCSPanel from '@/core/layout/components/GCSPanel.vue'
import { useMapStore } from '@/stores'
import BarChart from '@/visualization/charts/BarChart.vue'
import LineChart from '@/visualization/charts/LineChart.vue'
import PortInfoPanel from '@/visualization/panels/PortInfoPanel.vue'

const mapStore = useMapStore()

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
 */
const chartData = {
  labels: ['2019', '2020', '2021', '2022', '2023', '2024'],
  series: [
    { name: '钦州港', data: [120, 132, 101, 134, 190, 230] },
    { name: '北海港', data: [90, 110, 120, 115, 140, 180] },
    { name: '防城港', data: [80, 95, 110, 125, 150, 170] },
  ],
}

/**
 * 柱状图数据（首页默认展示，c023 从 AppLayout 下沉）
 */
const barData = {
  labels: ['钦州港', '北海港', '防城港'],
  series: [
    { name: '2023年', data: [190, 140, 150] },
    { name: '2024年', data: [230, 180, 170] },
  ],
}
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
