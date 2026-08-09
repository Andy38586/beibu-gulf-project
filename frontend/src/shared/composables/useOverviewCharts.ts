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
 * 首页/个人中心共用：港口吞吐量图表数据。
 * 2026-08-09（P0-3）：原两页各自持有硬编码假数据，抽为共享
 * composable 后统一从 /forecast/overview 静态快照读取；
 * 接口失败留空（图表 EmptyState 兜底），不回落假数据。
 * 快照内容（backend/data/forecast/index.json charts）为 cargo 月度数据，
 * 与预测分析页默认视图同源（历史截至 2026-06，2026-08-09 月度化）。
 */
export function useOverviewCharts() {
  const { apiRequest } = useApiRequest()

  const chartData = ref<ChartDataset>({ labels: [], series: [] })
  const barData = ref<ChartDataset>({ labels: [], series: [] })

  async function loadOverviewCharts(): Promise<void> {
    try {
      // 读 overview 的 charts 静态快照——不用 timeseries 接口
      // （cargo.json 无 forecast 段会触发预测模型计算，首页不应跑预测）
      const res = await apiRequest<OverviewResponse>('/forecast/overview')
      const charts = res.charts
      if (!charts || charts.series.length === 0) return
      chartData.value = {
        labels: charts.labels,
        series: charts.series,
      }
      // 柱状图：近 12 个月（快照窗口）三港月均吞吐量对比
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
      // 接口失败：图表留空（不回落硬编码假数据，避免上线假数据）
      logger.warn('[useOverviewCharts] 吞吐量图表数据加载失败:', error)
    }
  }

  return { chartData, barData, loadOverviewCharts }
}
