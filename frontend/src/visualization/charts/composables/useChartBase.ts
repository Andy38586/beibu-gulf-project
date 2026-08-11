import { CHART_COLORS, useTheme } from '@/shared'
import type { ChartClickParams, UseEChartsReturn } from '@/visualization/composables/useECharts'
import { useECharts } from '@/visualization/composables/useECharts'

/** 图表基础 props（LineChart / BarChart 通用） */
interface ChartBaseProps {
  title?: string
  xData?: string[]
  series?: Array<{ name: string; data: number[] }>
  xMin?: string
  xMax?: string
  yUnit?: string
}

/** 图表事件发射器 */
type ChartEmit = (event: 'select', dataIndex: number) => void

export function useChartBase(
  props: ChartBaseProps,
  emit: ChartEmit,
  chartType: string,
  seriesConfig: Record<string, unknown> = {}
): UseEChartsReturn {
  const { isDark } = useTheme()

  function handleClick(params: ChartClickParams): void {
    if (params.dataIndex == null) return
    emit('select', params.dataIndex)
  }

  /**
   * option 每次调用时现取 props 构建（避免一次性快照导致 props 更新后图表不刷新）。
   * watch 为浅监听：父组件更新数据必须替换数组引用（不可变更新），勿原地 push/splice
   */
  function buildOption(): Record<string, unknown> {
    const dark = isDark.value
    const dataLen = (props.xData || []).length
    const dense = dataLen > 24 // 月粒度超过 24 个点自动间隔
    return {
      backgroundColor: 'transparent',
      grid: { top: 40, right: 16, bottom: 40, left: 40 },
      title: {
        text: props.title,
        left: 'center',
        textStyle: {
          color: dark ? CHART_COLORS.textPrimary.dark : CHART_COLORS.textPrimary.light,
          fontSize: 16,
          fontWeight: 600,
        },
      },
      tooltip: { trigger: 'axis' },
      legend: {
        bottom: 0,
        textStyle: {
          color: dark ? CHART_COLORS.textSecondary.dark : CHART_COLORS.textSecondary.light,
          fontSize: 10,
        },
        itemWidth: 10,
        itemHeight: 6,
      },
      xAxis: {
        type: 'category',
        data: props.xData || [],
        axisLine: {
          lineStyle: { color: dark ? CHART_COLORS.axisLine.dark : CHART_COLORS.axisLine.light },
        },
        axisLabel: {
          color: dark ? CHART_COLORS.textSecondary.dark : CHART_COLORS.textSecondary.light,
          fontSize: 10,
          ...(dense ? { interval: 2, rotate: 30 } : {}),
        },
        ...(props.xMin ? { min: props.xMin } : {}),
        ...(props.xMax ? { max: props.xMax } : {}),
      },
      yAxis: {
        type: 'value',
        splitLine: {
          lineStyle: { color: dark ? CHART_COLORS.splitLine.dark : CHART_COLORS.splitLine.light },
        },
        axisLabel: {
          color: dark ? CHART_COLORS.textSecondary.dark : CHART_COLORS.textSecondary.light,
          fontSize: 10,
        },
        ...(props.yUnit
          ? {
              name: props.yUnit,
              nameTextStyle: {
                fontSize: 10,
                color: dark ? CHART_COLORS.textMuted.dark : CHART_COLORS.textMuted.light,
              },
            }
          : {}),
      },
      animationDuration: 300,
      animationEasing: 'linear',
      series: (props.series || []).map((s) => ({
        id: s.name, // 稳定 id：配合 replaceMerge:['series']，series 增减时正确对位
        name: s.name,
        type: chartType,
        data: s.data || [],
        ...seriesConfig,
      })),
    }
  }

  return useECharts({
    getOption: buildOption,
    watchSources: [
      () => props.title,
      () => props.xData,
      () => props.series,
      () => props.xMin,
      () => props.xMax,
    ],
    onClick: handleClick,
  })
}
