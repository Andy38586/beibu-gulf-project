/**
 * useForecastComparison — 港口对比（柱状图）数据 composable（专项1 [1.1][2.2][2.4]）：
 * 请求经 forecastAdapter（service 层隔离），组件零 HTTP/字段细节；缓存存 store；
 * 双真指标并行请求共享事务，任一过期整体跳过渲染。429 播放限流静默降级与页面原实现一致。
 */
import { ref } from 'vue'
import { useRouter } from 'vue-router'

import {
  ApiError,
  DEFAULT_CONFIDENCE,
  handleAuthError,
  isAuthError,
  logger,
  showError,
} from '@/shared'
import { PORT_NAMES } from '@/shared'
import { forecastAdapter } from '@/services'
import { useForecastStore } from '@/stores'

import { useForecastRequest } from './useForecastRequest'

// 柱状图固定对比真实吞吐量指标（cargo/container；合成数据不入图），当前 3 港 × 2 指标 = 6 柱
const BAR_INDICATORS = ['cargo', 'container'] as const
const BAR_INDICATOR_LABELS: Record<string, string> = {
  cargo: '货物吞吐量',
  container: '集装箱吞吐量',
}

export function useForecastComparison() {
  const router = useRouter()
  const forecastState = useForecastStore()
  const { runInTransaction, isTransactionValid } = useForecastRequest()

  const barXData = ref<string[]>([])
  const barSeries = ref<Array<{ name: string; data: number[] }>>([])

  async function load(transactionId: number, signal: AbortSignal): Promise<void> {
    try {
      const rawTime = forecastState.currentTime
      const time = rawTime.includes('-') ? rawTime : `${rawTime}-12`
      const confKey = BAR_INDICATORS.map(
        (i) => forecastState.confidenceThresholds[i] ?? DEFAULT_CONFIDENCE
      ).join(',')
      const cacheKey = `cmp:${time}:${confKey}`
      const cached = forecastState.requestCache.get(cacheKey)
      if (cached) {
        // 事务检查：即使缓存命中也要验证事务有效性
        if (!isTransactionValid(transactionId)) return
        const c = cached as { xData: string[]; series: Array<{ name: string; data: number[] }> }
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
                {
                  time,
                  confidence: forecastState.confidenceThresholds[ind] || DEFAULT_CONFIDENCE,
                },
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
      forecastState.setRequestCache(cacheKey, { xData: barXData.value, series: barSeries.value })
    } catch (e) {
      logger.error('[ForecastComparison] load error:', e)
      if (isAuthError(e)) {
        void handleAuthError(router)
        return
      }
      // 播放中命中后端限流（429）：静默降级不弹窗（同 useForecastLayer）
      if (forecastState.isPlaying && e instanceof ApiError && e.message.includes('过于频繁')) {
        return
      }
      // 失败用 toast：切换时间/指标即自动重试
      showError(e, { fallback: '加载对比数据失败' })
    }
  }

  return { barXData, barSeries, load }
}
