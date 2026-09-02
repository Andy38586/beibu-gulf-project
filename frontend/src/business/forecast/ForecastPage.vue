<!--
  /**
   * 预测分析模块：纯 API 链路（cargo/container 为后端模型预测的真实吞吐量，
   * berth/traffic 为合成示意数据）。验证 heatmap 图层注册/销毁、
   * 纯 2D 业务承载与时间轴驱动的图层增量更新性能。
   * 布局：左 LineChart + BarChart，右 ForecastControlPanel + LayerControlPanel（各 4×4）
   */
-->
<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue'

import { AppLayout, GCSPanel, LayerControlPanel } from '@/core'
import { logger, useProfileSnapshot } from '@/shared'
import { useForecastStore } from '@/stores'
import { useMapStore } from '@/stores'
import type { ForecastSavedState } from '@/stores/forecastStore'
import { BarChart, ChartLoading, LineChart } from '@/visualization'

import ForecastControlPanel from './components/ForecastControlPanel.vue'
import { useForecastComparison } from './composables/useForecastComparison'
import { useForecastLayer } from './composables/useForecastLayer'
import { useForecastRequest } from './composables/useForecastRequest'
import { useForecastTimeseries } from './composables/useForecastTimeseries'

const forecastState = useForecastStore()
const mapStore = useMapStore()
const { updateForecastLayer, removeForecastLayer, renderer } = useForecastLayer()
const { startTransaction, cancelAll } = useForecastRequest()
const {
  lineXData,
  lineSeries,
  lineViewportXMin,
  lineViewportXMax,
  load: loadTimeSeriesData,
} = useForecastTimeseries()
const { barXData, barSeries, load: loadPortComparisonData } = useForecastComparison()

let debounceTimer: ReturnType<typeof setTimeout> | null = null
const DEBOUNCE_DELAY = 300

/** 跳转个人中心（登录）时保存状态，返回恢复；其它路由离开时组件卸载清态 */
useProfileSnapshot({ save: saveForecastState })

/** 保存当前状态到 store 快照（requestCache 序列化为数组，避免引用连带清空） */
function saveForecastState(): void {
  forecastState.saveState({
    currentTime: forecastState.currentTime,
    timeGranularity: forecastState.timeGranularity,
    playSpeed: forecastState.playSpeed,
    activeIndicator: forecastState.activeIndicator,
    confidenceThresholds: { ...forecastState.confidenceThresholds },
    activeForecastLayer: forecastState.activeForecastLayer,
    requestCache: Array.from(forecastState.requestCache.entries()),
  })
}

/** 恢复快照：一次性收口到 store action；renderer watch（immediate）兜底触发加载 */
function restoreForecastState(saved: ForecastSavedState): void {
  forecastState.restoreState(saved)
}

onMounted(() => {
  // 跳登录返回优先恢复快照（不 reset，避免清掉刚恢复的状态）；无快照才走初始化
  const savedState = forecastState.consumeState()
  if (savedState) {
    restoreForecastState(savedState)
    return
  }
  forecastState.reset()
})

watch(
  () => mapStore.currentRenderer,
  (r) => {
    logger.debug('[ForecastPage] renderer watch triggered:', r ? 'renderer ready' : 'renderer null')
    if (r) {
      logger.debug('[ForecastPage] loading data...')
      void doForecastUpdate()
    } else {
      logger.debug('[ForecastPage] renderer is null, waiting...')
    }
  },
  { immediate: true }
)

// 统一预测更新：启动新事务保证三路请求原子性（loading 状态不绑定 UI）
async function doForecastUpdate() {
  if (!renderer.value) return

  // 启动新事务，取消旧请求
  const { transactionId, signal } = startTransaction()

  // 三个请求共享同一事务，保证数据一致性
  await Promise.all([
    loadTimeSeriesData(transactionId, signal),
    loadPortComparisonData(transactionId, signal),
    updateForecastLayer(transactionId, signal),
  ])
}

// 合并监听 indicator/time/confidence，纯防抖（debounce，300ms）停止操作后统一刷新，避免双触发
watch(
  () => [
    forecastState.activeIndicator,
    forecastState.currentTime,
    forecastState.confidenceThresholds[forecastState.activeIndicator],
  ],
  () => {
    // 每次状态变化都重置防抖定时器
    clearTimeout(debounceTimer ?? undefined)
    debounceTimer = setTimeout(() => doForecastUpdate(), DEBOUNCE_DELAY)
  }
)

onUnmounted(() => {
  // 清理防抖定时器，避免卸载后触发 doForecastUpdate
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  cancelAll()
  removeForecastLayer()
  forecastState.reset()
})
</script>

<template>
  <div class="forecast-page">
    <AppLayout>
      <template #left>
        <GCSPanel :w="4" :h="4" anchor="top-left" :offset-x="0" :offset-y="1.25">
          <LineChart
            title="预测趋势"
            :x-data="lineXData"
            :series="lineSeries"
            :x-min="lineViewportXMin"
            :x-max="lineViewportXMax"
          />
          <!-- 816-专项5主 6：数据刷新期 loading 覆盖（isRequesting 由事务 composable 驱动），
               原注释"加载态不绑定 UI"已废止——弱网下用户可感知更新进行中 -->
          <ChartLoading v-if="forecastState.isRequesting" />
        </GCSPanel>
        <GCSPanel :w="4" :h="4" anchor="top-left" :offset-x="0" :offset-y="5.5">
          <BarChart title="港口对比" :x-data="barXData" :series="barSeries" />
          <ChartLoading v-if="forecastState.isRequesting" />
        </GCSPanel>
      </template>
      <template #right>
        <GCSPanel :w="4" :h="4" anchor="top-right" :offset-x="0" :offset-y="1.25">
          <ForecastControlPanel />
        </GCSPanel>
        <GCSPanel :w="4" :h="4" anchor="top-right" :offset-x="0" :offset-y="5.5">
          <LayerControlPanel
            :layer-order="[
              'base-image',
              'base-vector',
              'boundary',
              'ports',
              'forecast-cargo',
              'forecast-berth',
              'forecast-traffic',
              'forecast-container',
            ]"
          />
        </GCSPanel>
      </template>
    </AppLayout>
  </div>
</template>

<style scoped>
.forecast-page {
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.forecast-page :deep(.GCS-panel) {
  pointer-events: auto;
}
</style>
