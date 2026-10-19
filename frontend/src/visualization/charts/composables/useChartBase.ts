import { computed, type ComputedRef, type Ref } from 'vue'

import { CHART_COLORS, CHART_GRID, chartColor, useTheme } from '@/shared'
import type { ChartClickParams, UseEChartsReturn } from '@/visualization/composables/useECharts'
import { useECharts } from '@/visualization/composables/useECharts'

/** 图表基础 props（LineChart / BarChart 通用） */
interface ChartBaseProps {
  title?: string
  xData?: string[]
  // data 允许 null（无数据空档，ECharts 原生支持）
  // yAxisIndex：该系列绑定的数值轴（双轴图使用；省略默认 0 即左轴）
  series?: Array<{ name: string; data: Array<number | null>; yAxisIndex?: number }>
  xMin?: string
  xMax?: string
  yUnit?: string
  // 右轴单位：传入时渲染左右双 Y 轴（不同量纲系列各占一轴）；省略为单轴
  yUnitRight?: string
}

/** 图表事件发射器 */
type ChartEmit = (event: 'select', dataIndex: number) => void

/**
 * @param chartRef 组件自持的容器 ref（模板 ref 必须绑定到 setup 作用域内的变量）。
 *   缺省时 useECharts 内部自建——此时绑定不到模板，仅适用于无模板容器的场景。
 */
export function useChartBase(
  props: ChartBaseProps,
  emit: ChartEmit,
  chartType: string,
  seriesConfig: Record<string, unknown> = {},
  chartRef?: Ref<HTMLElement | null>
): UseEChartsReturn & { hasData: ComputedRef<boolean> } {
  const { isDark } = useTheme()

  /** 是否有可画的数据：LineChart / BarChart 的空态浮层共用（chartRef 始终挂载） */
  const hasData = computed<boolean>(() => {
    if (!props.series || props.series.length === 0) return false
    return props.series.some((s) => s.data && s.data.length > 0)
  })

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
      // 多分类系列色板顶层注入（seriesPalette），替代 ECharts 默认 #5470c6 系列；
      // 随主题重渲染（useECharts watchSources 含 isDark）
      color: CHART_COLORS.seriesPalette[dark ? 'dark' : 'light'],
      grid: { ...CHART_GRID },
      title: {
        // 不显式设置 top：保持 ECharts 默认（tokens.size.m=15 + padding 5 → 文字顶边 12px），
        // 与 CHART_TITLE_TOP 对齐（scripts/measure-title.mjs 实测；改默认前需同步该常量）
        text: props.title,
        left: 'center',
        textStyle: {
          color: chartColor('textPrimary', dark),
          fontSize: 16,
          fontWeight: 600,
        },
      },
      // confine: true —— 把 tooltip 约束在图表 DOM 内。
      // 4×4 面板（GCSPanel）是 overflow:hidden，而 ECharts 的 html tooltip 默认会"躲视口边缘"
      // 逃出容器 ⇒ 被面板裁掉。2026-10-02 实测（320×320 面板悬停铁矿石柱）：tooltip x=-25、
      // 面板 x=20 ⇒ 左侧 45px 被裁，只剩「吨/年）+ 数值」。confine 后 tooltip 恒在 canvas 内。
      tooltip: {
        trigger: 'axis',
        confine: true,
        // 只改显示不改数据（用户 2026-10-02）：浮点原始值会渲染成 837.5550000000001，
        // 四舍五入到 2 位并去掉多余的 .00（整数仍显整数）。极小量（|v|<0.01）保留原值，
        // 否则会被抹成 0（KDE 这类量级若将来进本图）——是防误伤，不是当前需要。
        valueFormatter: (value: number): string => {
          if (!Number.isFinite(value)) return String(value)
          const abs = Math.abs(value)
          if (abs !== 0 && abs < 0.01) return String(value)
          return String(Number(value.toFixed(2)))
        },
      },
      legend: {
        bottom: 0,
        textStyle: {
          color: chartColor('textSecondary', dark),
          fontSize: 10,
        },
        itemWidth: 10,
        itemHeight: 6,
      },
      xAxis: {
        type: 'category',
        data: props.xData || [],
        axisLine: {
          lineStyle: { color: chartColor('axisLine', dark) },
        },
        axisLabel: {
          color: chartColor('textSecondary', dark),
          fontSize: 10,
          ...(dense ? { interval: 2, rotate: 30 } : {}),
        },
        ...(props.xMin ? { min: props.xMin } : {}),
        ...(props.xMax ? { max: props.xMax } : {}),
      },
      // 左轴（单轴图即此轴）。双轴时右轴不画分割线（两套网格会交错成噪音）
      yAxis: (() => {
        const left = {
          type: 'value',
          splitLine: {
            lineStyle: {
              color: chartColor('splitLine', dark),
            },
          },
          axisLabel: {
            color: chartColor('textSecondary', dark),
            fontSize: 10,
          },
          ...(props.yUnit
            ? {
                name: props.yUnit,
                nameTextStyle: {
                  fontSize: 10,
                  color: chartColor('textMuted', dark),
                },
              }
            : {}),
        }
        if (!props.yUnitRight) return left
        const right = {
          type: 'value',
          position: 'right',
          splitLine: { show: false },
          axisLabel: {
            color: chartColor('textSecondary', dark),
            fontSize: 10,
          },
          name: props.yUnitRight,
          nameTextStyle: {
            fontSize: 10,
            color: chartColor('textMuted', dark),
          },
        }
        return [left, right]
      })(),
      animationDuration: 300,
      animationEasing: 'linear',
      series: (props.series || []).map((s) => ({
        id: s.name, // 稳定 id：配合 replaceMerge:['series']，series 增减时正确对位
        name: s.name,
        type: chartType,
        data: s.data || [],
        ...(s.yAxisIndex != null ? { yAxisIndex: s.yAxisIndex } : {}),
        ...seriesConfig,
      })),
    }
  }

  return {
    ...useECharts({
      getOption: buildOption,
      watchSources: [
        () => props.title,
        () => props.xData,
        () => props.series,
        () => props.xMin,
        () => props.xMax,
        () => props.yUnitRight,
      ],
      onClick: handleClick,
      ...(chartRef ? { chartRef } : {}),
    }),
    hasData,
  }
}
