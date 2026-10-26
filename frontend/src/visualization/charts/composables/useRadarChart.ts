/** useRadarChart — 雷达图渲染/交互/事件逻辑（复用 useECharts 统一图表生命周期） */
import { RadarChart as EChartsRadarChart } from 'echarts/charts'
import { TooltipComponent } from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import type { Ref } from 'vue'
import { onBeforeUnmount, ref } from 'vue'

import {
  CHART_COLORS,
  CHART_GRID,
  chartColor,
  RADAR_AXIS_NAME_ALLOWANCE,
  RADAR_AXIS_NAME_FONT_SIZE,
  RADAR_AXIS_NAME_GAP,
  RADAR_TOOLTIP_HEIGHT_CELL,
  RADAR_TOOLTIP_WIDTH_CELL,
} from '@/shared'
import { FACILITY_LABELS } from '@/shared'
import { useGCS } from '@/shared'
import { chartAxisLineOption, chartTitleOption } from '@/visualization/charts/chartTheme'
import { useTheme } from '@/shared'
import { logger } from '@/shared'
import { perfMark, perfMeasure } from '@/shared'
import type { ScoredXiaoqu } from '@/types/xiaoqu'
import { useECharts } from '@/visualization/composables/useECharts'

// 注册 ECharts 组件
echarts.use([EChartsRadarChart, TooltipComponent, CanvasRenderer])

/** 雷达图所需 props 子集（来自 RadarChart.vue） */
interface RadarChartProps {
  xiaoqu: ScoredXiaoqu | null
  selectedTypes: string[]
  /** 雷达图标题（缺省时用 "xx小区评分详情图"） */
  title?: string
}

/** useRadarChart 配置选项 */
interface UseRadarChartOptions {
  /** 图表容器 ref（由组件声明并绑定模板，v-if 下 xiaoqu 为空时容器不存在） */
  chartRef: Ref<HTMLElement | null>
  getScoreAreaRef: () => HTMLElement | null
  getProps: () => RadarChartProps
}

/** 详情面板位置（viewport 坐标） */
interface TooltipPosition {
  left: number
  top: number
}

/** useRadarChart 返回值 */
interface UseRadarChartReturn {
  tooltipVisible: Ref<boolean>
  tooltipPosition: Ref<TooltipPosition>
  renderRadar: () => void
  handleScoreClick: () => void
  handleGlobalClick: (e: MouseEvent) => void
}

export function useRadarChart({
  chartRef,
  getScoreAreaRef,
  getProps,
}: UseRadarChartOptions): UseRadarChartReturn {
  const { isDark } = useTheme()
  const { cellPixel } = useGCS()
  // 尺寸重试定时器：保存引用供 onBeforeUnmount 清理，卸载后不再重试渲染
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  // 尺寸重试计数：必须住 composable 作用域——曾写在 DOM 节点
  // （chartRef.value._radar_retryCount）上，容器被 v-if 撤下后计数无处存放，
  // 「最多 10 次」永不生效，每 100ms 无限自排
  let radarRetryCount = 0

  /** 浮窗状态 */
  const tooltipVisible = ref<boolean>(false)
  /** 详情面板位置（打开时按雷达面板 rect 计算，与 RadarScoreTooltip 尺寸公式保持一致） */
  const tooltipPosition = ref<TooltipPosition>({ left: 0, top: 0 })

  /** 构建雷达图 option（每次现取容器尺寸，radius 依赖容器大小） */
  function buildRadarOption(): Record<string, unknown> {
    const props = getProps()
    const dark = isDark.value
    const el = chartRef.value
    const w = el?.clientWidth ?? 0
    const h = el?.clientHeight ?? 0

    // 容器尺寸不足时重试，最多重试10次（1秒）
    if (w < 10 || h < 10) {
      radarRetryCount++
      if (radarRetryCount > 10) {
        logger.debug('雷达图容器尺寸持续不足，放弃渲染')
        return { backgroundColor: 'transparent' }
      }
      if (retryTimer) clearTimeout(retryTimer)
      retryTimer = setTimeout(() => {
        retryTimer = null
        renderRadar()
      }, 100)
      return { backgroundColor: 'transparent' }
    }
    // 尺寸恢复正常：重置重试计数
    radarRetryCount = 0

    const indicators = props.selectedTypes.map((key) => ({
      name: FACILITY_LABELS[key] || key,
      max: 100,
    }))

    const values = props.selectedTypes.map((key) => props.xiaoqu?.breakdown?.[key] ?? 0)

    const name = props.xiaoqu?.name || ''
    const title = props.title || (name ? `${name}评分详情图` : '')

    // 标题由 ECharts 绘制（与 LineChart/BarChart 一致，占 canvas 顶部 CHART_GRID.top 高度）；
    // 雷达多边形以「标题下方剩余区域」的中心为圆心，避开标题区，radius 按可用高度计算
    const titleSpace = CHART_GRID.top
    const availW = w
    const availH = Math.max(h - titleSpace, 0)
    const radarRadius = Math.max(Math.min(availW, availH) / 2 - RADAR_AXIS_NAME_ALLOWANCE, 20)
    const radarCenter: [number, number] = [w / 2, titleSpace + availH / 2]

    return {
      backgroundColor: 'transparent',
      title: chartTitleOption(title, dark),
      tooltip: { show: false },
      radar: {
        indicator: indicators,
        radius: radarRadius,
        center: radarCenter,
        // ECharts 的 radar 轴名点击必须在根级开启：RadarModel 从 radar 根读取 triggerEvent
        // 下发到各指示器轴模型，axisName 节点只承载样式（写在 axisName 里不生效）
        triggerEvent: true,
        axisName: {
          color: chartColor('accent', dark),
          fontSize: RADAR_AXIS_NAME_FONT_SIZE,
          fontWeight: 500,
          gap: RADAR_AXIS_NAME_GAP,
          cursor: 'pointer',
        },
        splitLine: {
          lineStyle: { color: chartColor('splitLine', dark) },
        },
        splitArea: {
          areaStyle: {
            // 叠层色收敛到 CHART_COLORS（原 isDark 分支 rgba 硬编码）
            color: CHART_COLORS.radarSplitArea[dark ? 'dark' : 'light'],
          },
        },
        axisLine: chartAxisLineOption(dark),
      },
      series: [
        {
          type: 'radar',
          symbolSize: 6,
          lineStyle: {
            width: 2,
            color: chartColor('accent', dark),
          },
          itemStyle: { color: chartColor('accent', dark) },
          data: [
            {
              value: values,
              name: name,
              areaStyle: {
                opacity: 0.3,
                color: chartColor('accent', dark),
              },
            },
          ],
        },
      ],
    }
  }

  // 统一图表生命周期委托 useECharts：init/dispose/resize/theme/watch 由它管理
  const { updateChart } = useECharts({
    getOption: buildRadarOption,
    chartRef,
    recomputeOptionOnResize: true,
    watchSources: [() => getProps().xiaoqu, () => getProps().selectedTypes],
  })

  /** 渲染雷达图（对外保留：数据变化 / 容器可见后由组件显式触发） */
  function renderRadar(): void {
    perfMark('echarts:radar:start')
    updateChart()
    perfMark('echarts:radar:end')
    perfMeasure('echarts:setOption:radar', 'echarts:radar:start', 'echarts:radar:end')
  }

  /** 点击综合评分：打开/关闭详情面板。在雷达面板内水平居中，位于综合评分上方 */
  function handleScoreClick(): void {
    if (tooltipVisible.value) {
      tooltipVisible.value = false
      return
    }

    const panelEl = chartRef.value?.closest('.radar-panel')
    if (panelEl) {
      const panelRect = panelEl.getBoundingClientRect()
      const scoreRect = getScoreAreaRef()?.getBoundingClientRect() ?? null
      const tooltipW = cellPixel.value * RADAR_TOOLTIP_WIDTH_CELL
      const tooltipH = cellPixel.value * RADAR_TOOLTIP_HEIGHT_CELL
      // 横向：面板内水平居中
      const left = panelRect.left + (panelRect.width - tooltipW) / 2
      // 纵向：紧贴综合评分上方（4px 间距），不超出面板顶部
      const scoreTop = scoreRect ? scoreRect.top : panelRect.bottom
      const top = Math.max(scoreTop - tooltipH + 20, panelRect.top + 4)
      tooltipPosition.value = { left: Math.max(left, panelRect.left), top }
    }

    tooltipVisible.value = true
  }

  /** 点击其他地方关闭浮窗 */
  function handleGlobalClick(e: MouseEvent): void {
    const tooltipEl = document.querySelector('.radar-tooltip')
    const scoreEl = document.querySelector('.score-text')

    if (
      tooltipVisible.value &&
      tooltipEl &&
      !tooltipEl.contains(e.target as Node) &&
      !scoreEl?.contains(e.target as Node)
    ) {
      tooltipVisible.value = false
    }
  }

  onBeforeUnmount(() => {
    // 全局点击监听由 RadarChart.vue 的 watch/卸载钩子管理；此处清理尺寸重试定时器
    if (retryTimer) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
  })

  return {
    tooltipVisible,
    tooltipPosition,
    renderRadar,
    handleScoreClick,
    handleGlobalClick,
  }
}
