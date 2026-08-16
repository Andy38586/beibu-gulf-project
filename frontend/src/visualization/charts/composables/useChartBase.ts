import { CHART_COLORS, CHART_GRID, useTheme } from '@/shared'
import type { ChartClickParams, UseEChartsReturn } from '@/visualization/composables/useECharts'
import { useECharts } from '@/visualization/composables/useECharts'

/** 图表基础 props（LineChart / BarChart 通用） */
interface ChartBaseProps {
  title?: string
  xData?: string[]
  // 816-专项1 发现18：data 允许 null（无数据空档，ECharts 原生支持）
  series?: Array<{ name: string; data: Array<number | null> }>
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
      // 816-S7-34：多分类系列色板顶层注入（seriesPalette），替代 ECharts 默认 #5470c6 系列；
      // 随主题重渲染（useECharts watchSources 含 isDark）
      color: CHART_COLORS.seriesPalette[dark ? 'dark' : 'light'],
      grid: { ...CHART_GRID },
      title: {
        // 不显式设置 top：保持 ECharts 默认（tokens.size.m=15 + padding 5 → 文字顶边 12px），
        // 与 CHART_TITLE_TOP 对齐（scripts/measure-title.mjs 实测；改默认前需同步该常量）
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
