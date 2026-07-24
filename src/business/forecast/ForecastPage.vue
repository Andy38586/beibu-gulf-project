<!-- FORECAST: 预测分析业务页面
     布局：左侧 LineChart(4×4) + BarChart(4×4)
           右侧 ForecastControlPanel(4×4) + LayerControlPanel(4×4) -->
<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'
import AppLayout from '@/core/layout/AppLayout.vue'
import GcsPanel from '@/core/layout/components/GcsPanel.vue'
import LineChart from '@/visualization/charts/LineChart.vue'
import BarChart from '@/visualization/charts/BarChart.vue'
import LayerControlPanel from '@/shared/components/LayerControlPanel.vue'
import ForecastControlPanel from './components/ForecastControlPanel.vue'
import { useForecastState } from '@/stores/forecastState'
import { useForecastLayer } from './composables/useForecastLayer'
import { useApiRequest } from '@/shared/composables/useApiRequest'
import { useMapStore } from '@/stores/map'

const forecastState = useForecastState()
const mapStore = useMapStore()
const { updateForecastLayer, removeForecastLayer, renderer } = useForecastLayer()
const { apiRequest } = useApiRequest()

const lineXData = ref([])
const lineSeries = ref([])
const barXData = ref(['钦州港', '北海港', '防城港'])
const barSeries = ref([])

const lineViewportXMin = ref('2023-01')
const lineViewportXMax = ref('2029-12')

const requestCache = new Map()
let timeSeriesReqSeq = 0
let portComparisonReqSeq = 0
let throttleBlockUntil = 0
let trailingTimer = null
const MIN_INTERVAL = 300
const TRAILING_DELAY = 250

// 发展情景映射（业务语义层，未来可替换为真实算法参数）
const SCENARIO_CONFIG = {
  0.8: { label: '保守发展', factor: 0.8 },
  1.0: { label: '基准发展', factor: 1.0 },
  1.2: { label: '高速发展', factor: 1.2 },
}
function getScenarioLabel(value) {
  const v = Math.round(value * 20) / 20  // 对齐到 0.05 步长
  return SCENARIO_CONFIG[v]?.label || `情景 ${(value * 100).toFixed(0)}%`
}

onMounted(() => { forecastState.reset(); requestCache.clear() })

async function loadTimeSeriesData() {
  console.log('[ForecastPage] loadTimeSeriesData called')
  try {
    const indicator = forecastState.activeIndicator
    const granularity = forecastState.timeGranularity
    console.log('[ForecastPage] loadTimeSeriesData:', { indicator, granularity })
    const confidence = forecastState.confidenceThresholds[indicator] || 0.8
    const cacheKey = `ts:${indicator}:${granularity}:${confidence}`

    // 全量数据: 首次 API 获取后缓存，后续只做窗口截取
    if (!requestCache.has(cacheKey)) {
      const seq = ++timeSeriesReqSeq
      const resp = await apiRequest(`/forecast/timeseries?indicator=${indicator}&granularity=${granularity}&confidence=${confidence}`)
      if (seq !== timeSeriesReqSeq) return
      if (resp.code === 200 && resp.data?.series) {
        requestCache.set(cacheKey, { allSeries: resp.data.series })
      }
    }

    const cached = requestCache.get(cacheKey)
    if (!cached?.allSeries) return

    // 7年窗口跟随滑块滑动: [滑块年份-3, 滑块年份+4)
    const [sliderYear, sliderMonth] = forecastState.currentTime.split('-').map(Number)
    const isYear = forecastState.timeGranularity === 'year'
    const fmt = (y, m) => isYear ? String(y) : `${y}-${String(m || 1).padStart(2, '0')}`
    const windowStart = fmt(sliderYear - 3, sliderMonth)
    const windowEnd = fmt(sliderYear + 3, 12)

    lineViewportXMin.value = windowStart
    lineViewportXMax.value = windowEnd

    const inWindow = (d) => d.time >= windowStart && d.time <= windowEnd

    lineXData.value = (cached.allSeries[0]?.data || []).filter(inWindow).map((d) => d.time)
    lineSeries.value = cached.allSeries.map((s) => ({
      name: s.portName,
      data: (s.data || []).filter(inWindow).map((d) => d.value),
    }))
  } catch (e) { console.error('[ForecastPage] loadTimeSeriesData error:', e); ElMessage.error('加载趋势数据失败') }
}

async function loadPortComparisonData() {
  console.log('[ForecastPage] loadPortComparisonData called')
  try {
    const indicator = forecastState.activeIndicator
    const rawTime = forecastState.currentTime
    const time = rawTime.includes('-') ? rawTime : `${rawTime}-12`
    console.log('[ForecastPage] loadPortComparisonData:', { indicator, time })
    const confidence = forecastState.confidenceThresholds[indicator] || 0.8
    const cacheKey = `cmp:${indicator}:${time}:${confidence}`
    if (requestCache.has(cacheKey)) { const c = requestCache.get(cacheKey); barXData.value = c.xData; barSeries.value = c.series; return }
    const seq = ++portComparisonReqSeq
    const resp = await apiRequest(`/forecast/indicator/${indicator}?time=${time}&confidence=${confidence}`)
    console.log('[ForecastPage] loadPortComparisonData response:', resp)
    if (seq !== portComparisonReqSeq) return
    if (resp.code === 200 && resp.data?.ports) {
      const p = resp.data.ports; const cy = forecastState.currentTime.split('-')[0]
      barXData.value = ['钦州港', '北海港', '防城港']
      barSeries.value = [{ name: cy + '年', data: [p.qinzhou?.value || 0, p.beihai?.value || 0, p.fangchenggang?.value || 0] }]
      requestCache.set(cacheKey, { xData: barXData.value, series: barSeries.value })
    }
  } catch (e) { console.error('[ForecastPage] loadPortComparisonData error:', e); ElMessage.error('加载对比数据失败') }
}

watch(() => mapStore.currentRenderer, (r) => {
  console.log('[ForecastPage] renderer watch triggered:', r ? 'renderer ready' : 'renderer null')
  if (r) {
    console.log('[ForecastPage] loading data...')
    loadTimeSeriesData()
    loadPortComparisonData()
    updateForecastLayer()
  } else {
    console.log('[ForecastPage] renderer is null, waiting...')
  }
}, { immediate: true })

// 自适应节流 + 尾随防抖: 快拖 300ms 保底刷新，停止 250ms 最终修正
async function doForecastUpdate() {
  if (renderer.value) await Promise.all([loadTimeSeriesData(), loadPortComparisonData(), updateForecastLayer()])
}

watch(() => [forecastState.currentTime, forecastState.activeIndicator], () => {
  const now = Date.now()

  // 每次滑块变动都重置尾随防抖 —— 保证最终位置一定刷新
  clearTimeout(trailingTimer)
  trailingTimer = setTimeout(() => doForecastUpdate(), TRAILING_DELAY)

  // 节流: 300ms 内只触发一次，快拖时至少 300ms 刷新一次，图表不白
  if (now < throttleBlockUntil) return
  throttleBlockUntil = now + MIN_INTERVAL
  doForecastUpdate()
})

watch(() => forecastState.timeGranularity, () => {
  if (renderer.value) {
    loadTimeSeriesData()
    loadPortComparisonData()
    updateForecastLayer()
  }
})

// 发展情景/置信度变化 → 刷新过滤后的数据
watch(
  () => forecastState.confidenceThresholds[forecastState.activeIndicator],
  () => {
    if (renderer.value) {
      loadTimeSeriesData()
      loadPortComparisonData()
      updateForecastLayer()
    }
  },
)

onUnmounted(() => { removeForecastLayer(); forecastState.reset() })
</script>

<template>
  <div class="forecast-page">
    <AppLayout>
      <template #left>
        <GcsPanel :w="4" :h="4" anchor="top-left" :offset-x="0" :offset-y="1.25">
          <LineChart title="预测趋势" :x-data="lineXData" :series="lineSeries" :x-min="lineViewportXMin" :x-max="lineViewportXMax" />
        </GcsPanel>
        <GcsPanel :w="4" :h="4" anchor="top-left" :offset-x="0" :offset-y="5.5">
          <BarChart title="港口对比" :x-data="barXData" :series="barSeries" />
        </GcsPanel>
      </template>
      <template #right>
        <GcsPanel :w="4" :h="4" anchor="top-right" :offset-x="0" :offset-y="1.25">
          <ForecastControlPanel />
        </GcsPanel>
        <GcsPanel :w="4" :h="4" anchor="top-right" :offset-x="0" :offset-y="5.5">
          <LayerControlPanel />
        </GcsPanel>
      </template>
    </AppLayout>
  </div>
</template>

<style scoped>
.forecast-page { width:100%; height:100%; pointer-events:none; }
.forecast-page :deep(.gcs-panel) { pointer-events:auto; }
</style>
