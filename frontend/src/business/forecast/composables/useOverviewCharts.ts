/**
 * useOverviewCharts — 首页/个人中心共用港口吞吐量图表数据：
 * 请求收口 forecastAdapter（services 层），shared 不再硬编码业务 URL；
 * 统一从 /forecast/overview 静态快照读取，接口失败留空（图表空状态兜底），不回落假数据。
 */
import { type Ref, ref } from 'vue'

import { forecastAdapter } from '@/services'
import { describeError, logger, showWarning } from '@/shared'

export interface ChartDataset {
  labels: string[]
  series: Array<{ name: string; data: number[] }>
}

/** 返回契约（816-专项3-0816-13：显式化，防重构时签名静默漂移） */
export interface UseOverviewChartsReturn {
  chartData: Ref<ChartDataset>
  barData: Ref<ChartDataset>
  loadOverviewCharts: () => Promise<void>
}

export function useOverviewCharts(): UseOverviewChartsReturn {
  const chartData = ref<ChartDataset>({ labels: [], series: [] })
  const barData = ref<ChartDataset>({ labels: [], series: [] })

  async function loadOverviewCharts(): Promise<void> {
    try {
      // 用 overview 静态快照而非 timeseries 接口：后者无 forecast 段会触发预测模型计算，首页不应跑预测
      const res = await forecastAdapter.getOverview()
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
            // 分母守卫：空系列除零 → NaN 会静默污染图表（02 §5.6 不变量 5），空系列按 0 处理
            data: charts.series.map((s) =>
              s.data.length === 0
                ? 0
                : Math.round((s.data.reduce((a, b) => a + b, 0) / s.data.length) * 100) / 100
            ),
          },
        ],
      }
    } catch (error) {
      // 图表失败不再静默——友好提示一次，仍留空图（不回落假数据）；
      // 文案经 describeError 区分成因：服务器无响应 ≠ 笼统「加载失败」
      logger.warn('[useOverviewCharts] 吞吐量图表数据加载失败:', error)
      showWarning(describeError(error, '图表数据加载失败，请稍后刷新'))
    }
  }

  return { chartData, barData, loadOverviewCharts }
}
