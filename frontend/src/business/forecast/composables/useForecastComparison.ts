/**
 * useForecastComparison — 港口对比（柱状图）数据 composable：
 * 请求经 forecastAdapter（service 层隔离），组件零 HTTP/字段细节；缓存存 store；
 * 双真指标并行请求共享事务，任一过期整体跳过渲染。429 播放限流静默降级与页面原实现一致。
 */
import { useRouter } from 'vue-router'

import { forecastAdapter } from '@/services'
import {
  ApiError,
  DEFAULT_CONFIDENCE,
  handleAuthError,
  isAuthError,
  logger,
  showError,
} from '@/shared'
import { PORT_KEYS, PORT_NAMES } from '@/shared'
import { useForecastStore } from '@/stores'

/** 返回契约（显式化，防重构时签名静默漂移）。v4-S3：结果写 store.chart，不再持本地 ref */
interface UseForecastComparisonReturn {
  load: (transactionId: number, signal: AbortSignal) => Promise<void>
}

import { useForecastRequest } from './useForecastRequest'

// 柱状图固定对比真实吞吐量指标（cargo/container；合成数据不入图），当前 3 港 × 2 指标 = 6 柱
const BAR_INDICATORS = ['cargo', 'container'] as const
const BAR_INDICATOR_LABELS: Record<string, string> = {
  cargo: '货物吞吐量',
  container: '集装箱吞吐量',
}

export function useForecastComparison(): UseForecastComparisonReturn {
  const router = useRouter()
  const forecastState = useForecastStore()
  const { runInTransaction, isTransactionValid } = useForecastRequest()

  async function load(transactionId: number, signal: AbortSignal): Promise<void> {
    try {
      const rawTime = forecastState.currentTime
      const time = rawTime.includes('-') ? rawTime : `${rawTime}-12`
      const confKey = BAR_INDICATORS.map(
        (i) => forecastState.confidenceThresholds[i] ?? DEFAULT_CONFIDENCE
      ).join(',')
      // 运河情景只影响 cargo 柱（container 无文献锚点，后端拒绝），缓存键须随情景区分
      const scenario = forecastState.canalScenario || 'baseline'
      const cacheKey = `cmp:${time}:${confKey}:${scenario}`
      const cached = forecastState.requestCache.get(cacheKey)
      if (cached) {
        // 事务检查：即使缓存命中也要验证事务有效性
        if (!isTransactionValid(transactionId)) return
        const c = cached as {
          xData: string[]
          series: Array<{ name: string; data: Array<number | null> }>
        }
        forecastState.chart.barXData = c.xData
        forecastState.chart.barSeries = c.series
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
                  // cargo 携带情景；container 无运河参数口径（04-B10），恒按基线请求
                  ...(ind === 'cargo' && scenario !== 'baseline' ? { scenario } : {}),
                },
                signal
              ),
            transactionId
          )
        )
      )
      // 任一请求事务过期 → 整体跳过本次渲染（等下一次状态变化）
      if (results.some((r) => r === null)) return
      forecastState.chart.barXData = [...PORT_NAMES]
      forecastState.chart.barSeries = BAR_INDICATORS.map((ind, i) => {
        const p = results[i]?.ports
        return {
          name: BAR_INDICATOR_LABELS[ind],
          // 无数据保留 null（图表空档），不再折叠为 0——
          // 后端 value 缺失时 `|| 0` 会把「无数据」伪装成「真实 0」。
          // 按 PORT_KEYS 取数：顺序与 barXData（PORT_NAMES）由同一权威源派生，不再手写 key
          data: PORT_KEYS.map((k) => p?.[k]?.value ?? null),
        }
      })
      forecastState.setRequestCache(cacheKey, {
        xData: forecastState.chart.barXData,
        series: forecastState.chart.barSeries,
      })
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

  return { load }
}
