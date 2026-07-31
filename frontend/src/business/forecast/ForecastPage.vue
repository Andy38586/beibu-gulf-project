<!--
  /**
   * 预测分析模块
   *
   * 当前阶段：架构验证期，使用 mock 数据跑通 2D 热力图 + 时间轴播放链路
   * 数据状态：src/mock/forecast/ 为 AI 生成的模拟港口吞吐量时序数据
   * 待接入：真实港口生产数据（毕业论文阶段替换）
   *
   * 本模块验证目标：
   * 1. BusinessLayerManager 的 heatmap adapter 能否独立注册/销毁
   * 2. 2D 渲染器在不依赖 3D 引擎时的纯 2D 业务承载能力
   * 3. 时间轴驱动下的图层增量更新性能
   */

  FORECAST: 预测分析业务页面
  布局：左侧 LineChart(4×4) + BarChart(4×4)
        右侧 ForecastControlPanel(4×4) + LayerControlPanel(4×4)
-->
<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'

import AppLayout from '@/core/layout/AppLayout.vue'
import GCSPanel from '@/core/layout/components/GCSPanel.vue'
import { forecastAdapter } from '@/services/adapters/forecastAdapter'
import LayerControlPanel from '@/shared/components/LayerControlPanel.vue'
import { handleAuthError, isAuthError, showError } from '@/shared/utils/errorHandler'
import { logger } from '@/shared/utils/logger'
import { useForecastState } from '@/stores/forecastState'
import { useMapStore } from '@/stores/mapStore'
import BarChart from '@/visualization/charts/BarChart.vue'
import LineChart from '@/visualization/charts/LineChart.vue'

import ForecastControlPanel from './components/ForecastControlPanel.vue'
import { useForecastLayer } from './composables/useForecastLayer'
import { useForecastRequest } from './composables/useForecastRequest'
import { DEFAULT_CONFIDENCE, PORT_NAMES } from './constants'

const forecastState = useForecastState()
const mapStore = useMapStore()
const { updateForecastLayer, removeForecastLayer, renderer } = useForecastLayer()
const {
  runInTransaction,
  startTransaction,
  isTransactionValid,
  cancelAll,
  isLoading: isTransactionLoading,
} = useForecastRequest()

// 绑定到事务 loading 状态，消除本地 isLoading 与事务间的竞态
const isLoading = isTransactionLoading

const lineXData = ref([])
const lineSeries = ref([])
const barXData = ref([...PORT_NAMES])
const barSeries = ref<Array<{ name: string; data: number[] }>>([])

const lineViewportXMin = ref('2023-01')
const lineViewportXMax = ref('2029-12')

const requestCache = new Map()
let debounceTimer: ReturnType<typeof setTimeout> | null = null
const DEBOUNCE_DELAY = 300

onMounted(() => {
  forecastState.reset()
  requestCache.clear()
})

async function loadTimeSeriesData(transactionId: number, signal: AbortSignal) {
  logger.debug('[ForecastPage] loadTimeSeriesData called')
  try {
    const indicator = forecastState.activeIndicator
    const granularity = forecastState.timeGranularity
    logger.debug('[ForecastPage] loadTimeSeriesData:', { indicator, granularity })
    const confidence = forecastState.confidenceThresholds[indicator] || DEFAULT_CONFIDENCE
    const cacheKey = `ts:${indicator}:${granularity}:${confidence}`

    // 全量数据: 首次 API 获取后缓存，后续只做窗口截取
    if (!requestCache.has(cacheKey)) {
      const data = await runInTransaction(
        () => forecastAdapter.getTimeSeries(indicator, granularity, confidence, signal),
        transactionId
      )
      // 事务过期或请求被取消
      if (data === null) return
      if (data?.series) {
        requestCache.set(cacheKey, { allSeries: data.series })
      }
    }

    const cached = requestCache.get(cacheKey)
    if (!cached?.allSeries) return

    const allData = cached.allSeries[0]?.data || []
    if (!allData.length) return

    // 7年窗口: [slider-3, slider+3]，钳制在数据实际范围内防止空白
    const [sliderYear, sliderMonth] = forecastState.currentTime.split('-').map(Number)
    const isYear = forecastState.timeGranularity === 'year'
    const fmt = (y: number, m: number) =>
      isYear ? String(y) : `${y}-${String(m || 1).padStart(2, '0')}`
    const dataMin = allData[0].time
    const dataMax = allData[allData.length - 1].time

    const rawStart = fmt(sliderYear - 3, sliderMonth)
    const rawEnd = fmt(sliderYear + 3, 12)
    const windowStart = rawStart >= dataMin ? rawStart : dataMin
    const windowEnd = rawEnd <= dataMax ? rawEnd : dataMax

    lineViewportXMin.value = windowStart
    lineViewportXMax.value = windowEnd

    const inWindow = (d: { time: string }) => d.time >= windowStart && d.time <= windowEnd

    lineXData.value = allData.filter(inWindow).map((d: { time: string }) => d.time)
    lineSeries.value = cached.allSeries.map(
      (s: { portName: string; data: Array<{ time: string; value: number }> }) => ({
        name: s.portName,
        data: (s.data || []).filter(inWindow).map((d: { value: number }) => d.value),
      })
    )
  } catch (e) {
    logger.error('[ForecastPage] loadTimeSeriesData error:', e)
    if (isAuthError(e)) {
      handleAuthError()
      return
    }
    showError(e, { fallback: '加载趋势数据失败' })
  }
}

async function loadPortComparisonData(transactionId: number, signal: AbortSignal) {
  logger.debug('[ForecastPage] loadPortComparisonData called')
  try {
    const indicator = forecastState.activeIndicator
    const rawTime = forecastState.currentTime
    const time = rawTime.includes('-') ? rawTime : `${rawTime}-12`
    logger.debug('[ForecastPage] loadPortComparisonData:', { indicator, time })
    const confidence = forecastState.confidenceThresholds[indicator] || DEFAULT_CONFIDENCE
    const cacheKey = `cmp:${indicator}:${time}:${confidence}`
    if (requestCache.has(cacheKey)) {
      // 事务检查：即使缓存命中也要验证事务有效性
      if (!isTransactionValid(transactionId)) return
      const c = requestCache.get(cacheKey)
      barXData.value = c.xData
      barSeries.value = c.series
      return
    }
    const data = await runInTransaction(
      () => forecastAdapter.getIndicatorComparison(indicator, time, confidence, signal),
      transactionId
    )
    logger.debug('[ForecastPage] loadPortComparisonData response:', data)
    // 事务过期或请求被取消
    if (data === null) return
    if (data?.ports) {
      const p = data.ports
      const cy = forecastState.currentTime.split('-')[0]
      barXData.value = [...PORT_NAMES]
      barSeries.value = [
        {
          name: cy + '年',
          data: [p.qinzhou?.value || 0, p.beihai?.value || 0, p.fangchenggang?.value || 0],
        },
      ]
      requestCache.set(cacheKey, { xData: barXData.value, series: barSeries.value })
    }
  } catch (e) {
    logger.error('[ForecastPage] loadPortComparisonData error:', e)
    if (isAuthError(e)) {
      handleAuthError()
      return
    }
    showError(e, { fallback: '加载对比数据失败' })
  }
}

watch(
  () => mapStore.currentRenderer,
  (r) => {
    logger.debug('[ForecastPage] renderer watch triggered:', r ? 'renderer ready' : 'renderer null')
    if (r) {
      logger.debug('[ForecastPage] loading data...')
      doForecastUpdate()
    } else {
      logger.debug('[ForecastPage] renderer is null, waiting...')
    }
  },
  { immediate: true }
)

// 统一的预测更新函数：启动新事务，保证三个请求原子性
// isLoading 由 useForecastRequest 单例管理，事务内自动设置/清除，无竞态
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

// 合并 watch：监听 indicator、time、confidence 三个核心状态
// 使用纯防抖(300ms)，停止操作后统一刷新，避免双触发
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
  requestCache.clear()
  forecastState.reset()
})
</script>

<template>
  <div v-loading="isLoading" class="forecast-page" element-loading-text="加载预测数据中...">
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
        </GCSPanel>
        <GCSPanel :w="4" :h="4" anchor="top-left" :offset-x="0" :offset-y="5.5">
          <BarChart title="港口对比" :x-data="barXData" :series="barSeries" />
        </GCSPanel>
      </template>
      <template #right>
        <GCSPanel :w="4" :h="4" anchor="top-right" :offset-x="0" :offset-y="1.25">
          <ForecastControlPanel />
        </GCSPanel>
        <GCSPanel :w="4" :h="4" anchor="top-right" :offset-x="0" :offset-y="5.5">
          <LayerControlPanel />
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
