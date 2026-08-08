<!--
  /**
   * 预测分析模块
   * 当前阶段：架构验证期，使用前端静态 JSON（public/data/forecast）跑通 2D 热力图 + 时间轴播放链路
   * 待接入：真实港口生产数据（毕业论文阶段替换）
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
import { onBeforeRouteLeave, useRouter } from 'vue-router'

import AppLayout from '@/core/layout/AppLayout.vue'
import GCSPanel from '@/core/layout/components/GCSPanel.vue'
import LayerControlPanel from '@/core/map/components/LayerControlPanel.vue'
import { forecastAdapter } from '@/services'
import { ApiError, handleAuthError, isAuthError, showError } from '@/shared'
import { logger } from '@/shared'
import { useForecastStore } from '@/stores'
import { useMapStore } from '@/stores'
import type { ForecastSavedState } from '@/stores/forecastStore'
import BarChart from '@/visualization/charts/BarChart.vue'
import LineChart from '@/visualization/charts/LineChart.vue'

import ForecastControlPanel from './components/ForecastControlPanel.vue'
import { useForecastLayer } from './composables/useForecastLayer'
import { useForecastRequest } from './composables/useForecastRequest'
// P7：兼容层 business/forecast/constants.ts 已删，常量统一从 @/shared 取
import { DEFAULT_CONFIDENCE, PORT_NAMES } from '@/shared'

const forecastState = useForecastStore()
const mapStore = useMapStore()
const router = useRouter()
const { updateForecastLayer, removeForecastLayer, renderer } = useForecastLayer()
const {
  runInTransaction,
  startTransaction,
  isTransactionValid,
  cancelAll,
} = useForecastRequest()

const lineXData = ref([])
const lineSeries = ref([])
const barXData = ref([...PORT_NAMES])
const barSeries = ref<Array<{ name: string; data: number[] }>>([])

// 柱状图固定对比的真指标（cargo/container 为真实吞吐量；berth/traffic 为合成数据不入图）。
// 3 港 × 2 指标 = 6 柱；后续接入更多真指标后扩为 4 指标 → 3 港 × 4 = 12 柱
const BAR_INDICATORS = ['cargo', 'container'] as const
const BAR_INDICATOR_LABELS: Record<string, string> = { cargo: '货物吞吐量', container: '集装箱吞吐量' }

const lineViewportXMin = ref('2023-01')
const lineViewportXMax = ref('2029-12')

// requestCache 大小上限，超限删除最早键（Map 迭代序即插入序，近似 LRU）
const MAX_CACHE_ENTRIES = 50
const requestCache = new Map()
function setRequestCache(key: string, value: unknown): void {
  if (requestCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = requestCache.keys().next().value
    if (oldestKey !== undefined) requestCache.delete(oldestKey)
  }
  requestCache.set(key, value)
}
let debounceTimer: ReturnType<typeof setTimeout> | null = null
const DEBOUNCE_DELAY = 300

/**
 * 跳转个人中心（登录）→ 保存全部状态；其它路由离开保持原行为（onUnmounted reset 清态）。
 * 与 SiteSelectionPage/FloodAnalysisPage 的「跳登录保存、返回恢复」链路对齐（2026-08-08）。
 */
onBeforeRouteLeave((to) => {
  if (to.path === '/profile') {
    saveForecastState()
  }
})

/** 保存当前状态到 store 快照（requestCache 序列化为数组，避免引用连带清空） */
function saveForecastState(): void {
  forecastState.saveState({
    currentTime: forecastState.currentTime,
    timeGranularity: forecastState.timeGranularity,
    playSpeed: forecastState.playSpeed,
    activeIndicator: forecastState.activeIndicator,
    confidenceThresholds: { ...forecastState.confidenceThresholds },
    activeForecastLayer: forecastState.activeForecastLayer,
    dataCache: Array.from(forecastState.dataCache.entries()),
    requestCache: Array.from(requestCache.entries()),
  })
}

/** 恢复快照：写回 store 状态 + 请求缓存；renderer watch（immediate）兜底触发加载 */
function restoreForecastState(saved: ForecastSavedState): void {
  forecastState.setCurrentTime(saved.currentTime)
  forecastState.setTimeGranularity(saved.timeGranularity)
  forecastState.setActiveIndicator(saved.activeIndicator)
  forecastState.playSpeed = saved.playSpeed
  forecastState.confidenceThresholds = { ...saved.confidenceThresholds }
  forecastState.activeForecastLayer = saved.activeForecastLayer
  // shallowRef 需重赋值引用才触发响应式
  forecastState.dataCache = new Map(saved.dataCache)
  requestCache.clear()
  saved.requestCache.forEach(([k, v]) => requestCache.set(k, v))
}

onMounted(() => {
  // 「跳登录返回」优先恢复快照（不 reset——reset 会清掉刚恢复的状态）；
  // 无快照（正常进入/刷新）才走原初始化
  const savedState = forecastState.consumeState()
  if (savedState) {
    restoreForecastState(savedState)
    return
  }
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
        setRequestCache(cacheKey, { allSeries: data.series })
      }
    }

    const cached = requestCache.get(cacheKey)
    if (!cached?.allSeries) return

    const allData = cached.allSeries[0]?.data || []
    if (!allData.length) return

    // 12 个月窗口：当前时间点往前 11 步（月粒度 11 个月 / 年粒度 11 年，共 12 个点），
    // 钳制在数据实际范围内防止空白
    const [sliderYear, sliderMonth] = forecastState.currentTime.split('-').map(Number)
    const isYear = forecastState.timeGranularity === 'year'
    const fmt = (y: number, m: number) =>
      isYear ? String(y) : `${y}-${String(m || 1).padStart(2, '0')}`
    const dataMin = allData[0].time
    const dataMax = allData[allData.length - 1].time

    const rawStart = isYear
      ? fmt(sliderYear - 11, 1)
      : (() => {
          const total = sliderYear * 12 + (sliderMonth - 1) - 11
          return fmt(Math.floor(total / 12), (total % 12) + 1)
        })()
    const rawEnd = fmt(sliderYear, sliderMonth)
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
      void handleAuthError(router)
      return
    }
    // d073: 趋势数据失败用 toast——时间/指标切换即自动重试，无需 modal
    showError(e, { fallback: '加载趋势数据失败' })
  }
}

async function loadPortComparisonData(transactionId: number, signal: AbortSignal) {
  logger.debug('[ForecastPage] loadPortComparisonData called')
  try {
    const rawTime = forecastState.currentTime
    const time = rawTime.includes('-') ? rawTime : `${rawTime}-12`
    const confKey = BAR_INDICATORS.map(
      (i) => forecastState.confidenceThresholds[i] ?? DEFAULT_CONFIDENCE
    ).join(',')
    const cacheKey = `cmp:${time}:${confKey}`
    if (requestCache.has(cacheKey)) {
      // 事务检查：即使缓存命中也要验证事务有效性
      if (!isTransactionValid(transactionId)) return
      const c = requestCache.get(cacheKey)
      barXData.value = c.xData
      barSeries.value = c.series
      return
    }
    // 双真指标并行请求（3 港 × 2 指标 = 6 柱）
    const results = await Promise.all(
      BAR_INDICATORS.map((ind) =>
        runInTransaction(
          () =>
            forecastAdapter.getIndicatorComparison(
              ind,
              time,
              forecastState.confidenceThresholds[ind] || DEFAULT_CONFIDENCE,
              signal
            ),
          transactionId
        )
      )
    )
    // 任一请求事务过期 → 整体跳过本次渲染（等下一次状态变化）
    if (results.some((r) => r === null)) return
    barXData.value = [...PORT_NAMES]
    barSeries.value = BAR_INDICATORS.map((ind, i) => {
      const p = results[i]?.ports
      return {
        name: BAR_INDICATOR_LABELS[ind],
        data: [p?.qinzhou?.value || 0, p?.beihai?.value || 0, p?.fangchenggang?.value || 0],
      }
    })
    setRequestCache(cacheKey, { xData: barXData.value, series: barSeries.value })
  } catch (e) {
    logger.error('[ForecastPage] loadPortComparisonData error:', e)
    if (isAuthError(e)) {
      void handleAuthError(router)
      return
    }
    // 播放中命中后端限流（429）：静默降级不弹窗（同 useForecastLayer）
    if (forecastState.isPlaying && e instanceof ApiError && e.message.includes('过于频繁')) {
      return
    }
    // d073: 对比数据失败用 toast——切换时间/指标即自动重试，无需 modal
    showError(e, { fallback: '加载对比数据失败' })
  }
}

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

// 统一的预测更新函数：启动新事务，保证三个请求原子性
// （2026-08-08：v-loading 蒙版已移除，事务 loading 状态不再绑定 UI）
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
  <!-- 2026-08-08：移除 v-loading 白色蒙版（用户判定粗糙，后续做动画替代） -->
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
