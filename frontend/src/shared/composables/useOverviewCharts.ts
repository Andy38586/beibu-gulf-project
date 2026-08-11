import { ref } from 'vue'

import { useApiRequest } from '@/shared/composables/useApiRequest'
import { logger } from '@/shared/utils/logger'

export interface OverviewCharts {
  indicator: string
  unit: string
  granularity?: string
  start?: string
  end?: string
  labels: string[]
  series: Array<{ name: string; data: number[] }>
}

interface OverviewResponse {
  metadata?: unknown
  charts?: OverviewCharts
}

export interface ChartDataset {
  labels: string[]
  series: Array<{ name: string; data: number[] }>
}

/**
 * 首页/个人中心共用港口吞吐量图表数据：统一从 /forecast/overview 静态快照读取，
 * 接口失败留空（图表空状态兜底），不回落假数据。
 */
export function useOverviewCharts() {
  const { apiRequest } = useApiRequest()

  const chartData = ref<ChartDataset>({ labels: [], series: [] })
  const barData = ref<ChartDataset>({ labels: [], series: [] })

  async function loadOverviewCharts(): Promise<void> {
    try {
      // 用 overview 静态快照而非 timeseries 接口：后者无 forecast 段会触发预测模型计算，首页不应跑预测
      const res = await apiRequest<OverviewResponse>('/forecast/overview')
      const charts = res.charts
      if (!charts || charts.series.length === 0) return
      chartData.value = {
        labels: charts.labels,
        series: charts.series,
      }
      // 柱状图：快照窗口内三港月均吞吐量对比
      barData.value = {
        labels: charts.series.map((s) => s.name),
        series: [
          {
            name: `${charts.labels[0]} ~ ${charts.labels[charts.labels.length - 1]} 月均（${charts.unit}）`,
            data: charts.series.map(
              (s) => Math.round((s.data.reduce((a, b) => a + b, 0) / s.data.length) * 100) / 100
            ),
          },
        ],
      }
    } catch (error) {
      // 失败留空：不回落假数据
      logger.warn('[useOverviewCharts] 吞吐量图表数据加载失败:', error)
    }
  }

  return { chartData, barData, loadOverviewCharts }
}
