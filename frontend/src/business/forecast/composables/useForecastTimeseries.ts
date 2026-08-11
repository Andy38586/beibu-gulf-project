/**
 * useForecastTimeseries — 预测趋势（折线图）数据 composable（专项1 [1.1][2.2][2.4]）：
 * 请求经 forecastAdapter（service 层隔离），组件零 HTTP/字段细节；缓存迁入 store
 * （跨页面快照由 store 统一序列化），事务经 useForecastRequest 保证三路请求原子性。
 * 错误处理与页面原实现一致：401 软登录、其余 showError 统一出口。
 */
import { ref } from 'vue'
import { useRouter } from 'vue-router'

import { handleAuthError, isAuthError, logger, showError } from '@/shared'
import { DEFAULT_CONFIDENCE } from '@/shared'
import { forecastAdapter } from '@/services'
import { useForecastStore } from '@/stores'

import { useForecastRequest } from './useForecastRequest'

interface SeriesItem {
  portName: string
  data: Array<{ time: string; value: number }>
}

export function useForecastTimeseries() {
  const router = useRouter()
  const forecastState = useForecastStore()
  const { runInTransaction } = useForecastRequest()

  const lineXData = ref<string[]>([])
  const lineSeries = ref<Array<{ name: string; data: number[] }>>([])
  const lineViewportXMin = ref('2023-01')
  const lineViewportXMax = ref('2029-12')

  /** 全量数据: 首次 API 获取后缓存，后续只做窗口截取（缓存存 store，快照可恢复） */
  async function load(transactionId: number, signal: AbortSignal): Promise<void> {
    try {
      const indicator = forecastState.activeIndicator
      const granularity = forecastState.timeGranularity
      const confidence = forecastState.confidenceThresholds[indicator] || DEFAULT_CONFIDENCE
      const cacheKey = `ts:${indicator}:${granularity}:${confidence}`

      const cached = forecastState.requestCache.get(cacheKey)
      if (!cached) {
        const data = await runInTransaction(
          () => forecastAdapter.getTimeSeries({ indicator, granularity, confidence }, signal),
          transactionId
        )
        // 事务过期或请求被取消
        if (data === null) return
        if (data.series) {
          forecastState.setRequestCache(cacheKey, { allSeries: data.series })
        }
      }

      const entry = forecastState.requestCache.get(cacheKey) as
        | { allSeries?: SeriesItem[] }
        | undefined
      const allData = entry?.allSeries?.[0]?.data || []
      if (!allData.length) return

      // 12 点窗口（当前时间往前 11 步，月/年粒度通用），钳制在数据范围内防止空白
      const [sliderYear, sliderMonth] = forecastState.currentTime.split('-').map(Number)
      const isYear = granularity === 'year'
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

      lineXData.value = allData.filter(inWindow).map((d) => d.time)
      lineSeries.value = (entry?.allSeries ?? []).map((s) => ({
        name: s.portName,
        data: (s.data || []).filter(inWindow).map((d) => d.value),
      }))
    } catch (e) {
      logger.error('[ForecastTimeseries] load error:', e)
      if (isAuthError(e)) {
        void handleAuthError(router)
        return
      }
      // 失败用 toast：切换时间/指标即自动重试
      showError(e, { fallback: '加载趋势数据失败' })
    }
  }

  return { lineXData, lineSeries, lineViewportXMin, lineViewportXMax, load }
}
