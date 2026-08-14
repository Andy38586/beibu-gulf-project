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
  FACILITY_COLORS_MAP,
  RADAR_AXIS_NAME_ALLOWANCE,
  RADAR_AXIS_NAME_FONT_SIZE,
  RADAR_AXIS_NAME_GAP,
  RADAR_TOOLTIP_HEIGHT_CELL,
  RADAR_TOOLTIP_WIDTH_CELL,
} from '@/shared'
import { FACILITY_LABELS } from '@/shared'
import { useGCS } from '@/shared'
import { useTheme } from '@/shared'
import { logger } from '@/shared'
import { perfMark, perfMeasure } from '@/shared/utils/perfReporter'
import type { FacilityPoint } from '@/types/facility'
import type { ScoredXiaoqu } from '@/types/xiaoqu'
import { useECharts } from '@/visualization/composables/useECharts'

// 注册 ECharts 组件
echarts.use([EChartsRadarChart, TooltipComponent, CanvasRenderer])

/** 雷达图所需 props 子集（来自 RadarChart.vue） */
interface RadarChartProps {
  xiaoqu: ScoredXiaoqu | null
  selectedTypes: string[]
  facilityPoi: Record<string, FacilityPoint[]>
  /** 雷达图标题（缺省时用 "xx小区评分详情图"） */
  title?: string
}

/** 雷达图容器元素（带重试计数的自定义属性） */
type RadarChartContainer = HTMLElement & { _radar_retryCount?: number }

/** show-facility-layer 事件载荷 */
interface FacilityLayerPayload {
  type: string
  poiList: FacilityPoint[]
  color: string
  label: string
}

/** 雷达图事件发射器 */
interface RadarChartEmit {
  (event: 'show-facility-layer', data: FacilityLayerPayload): void
  (event: 'hide-facility-layer'): void
}

/** useRadarChart 配置选项 */
interface UseRadarChartOptions {
  /** 图表容器 ref（由组件声明并绑定模板，v-if 下 xiaoqu 为空时容器不存在） */
  chartRef: Ref<HTMLElement | null>
  getScoreAreaRef: () => HTMLElement | null
  getProps: () => RadarChartProps
  emit: RadarChartEmit
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
  activeFacilityType: Ref<string | null>
  renderRadar: () => void
  handleScoreClick: () => void
  handleGlobalClick: (e: MouseEvent) => void
  setupResizeObserver: () => void
}

export function useRadarChart({
  chartRef,
  getScoreAreaRef,
  getProps,
  emit,
}: UseRadarChartOptions): UseRadarChartReturn {
  const { isDark } = useTheme()
  const { cellPixel } = useGCS()
  // 尺寸重试定时器：保存引用供 onBeforeUnmount 清理，卸载后不再重试渲染
  let retryTimer: ReturnType<typeof setTimeout> | null = null

  /** 浮窗状态 */
  const tooltipVisible = ref<boolean>(false)
  /** 详情面板位置（打开时按雷达面板 rect 计算，与 RadarScoreTooltip 尺寸公式保持一致） */
  const tooltipPosition = ref<TooltipPosition>({ left: 0, top: 0 })

  /** 当前选中的设施类型 */
  const activeFacilityType = ref<string | null>(null)

  /** 获取设施颜色（从 shared 色值映射取，不依赖 business 层） */
  function getFacilityColor(key: string): string {
    return FACILITY_COLORS_MAP[key] || '#666'
  }

  /** 构建雷达图 option（每次现取容器尺寸，radius 依赖容器大小） */
  function buildRadarOption(): Record<string, unknown> {
    const props = getProps()
    const dark = isDark.value
    const el = chartRef.value
    const w = el?.clientWidth ?? 0
    const h = el?.clientHeight ?? 0

    // 容器尺寸不足时重试，最多重试10次（1秒）
    if (w < 10 || h < 10) {
      const container = chartRef.value as RadarChartContainer | null
      const retryCount = ((container?._radar_retryCount || 0) + 1)
      if (container) {
        if (retryCount > 10) {
          logger.debug('雷达图容器尺寸持续不足，放弃渲染')
          return { backgroundColor: 'transparent' }
        }
        container._radar_retryCount = retryCount
      }
      if (retryTimer) clearTimeout(retryTimer)
      retryTimer = setTimeout(() => {
        retryTimer = null
        renderRadar()
      }, 100)
      return { backgroundColor: 'transparent' }
    }
    // 重置重试计数
    const container = chartRef.value as RadarChartContainer | null
    if (container?._radar_retryCount) {
      container._radar_retryCount = 0
    }

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
      title: {
        text: title,
        left: 'center',
        textStyle: {
          color: dark ? CHART_COLORS.textPrimary.dark : CHART_COLORS.textPrimary.light,
          fontSize: 16,
          fontWeight: 600,
        },
      },
      tooltip: { show: false },
      radar: {
        indicator: indicators,
        radius: radarRadius,
        center: radarCenter,
        axisName: {
          color: dark ? CHART_COLORS.accent.dark : CHART_COLORS.accent.light,
          fontSize: RADAR_AXIS_NAME_FONT_SIZE,
          fontWeight: 500,
          gap: RADAR_AXIS_NAME_GAP,
          cursor: 'pointer',
        },
        splitLine: {
          lineStyle: { color: dark ? CHART_COLORS.splitLine.dark : CHART_COLORS.splitLine.light },
        },
        splitArea: {
          areaStyle: {
            color: dark
              ? ['rgba(255,255,255,0.04)', 'rgba(255,255,255,0.12)']
              : ['rgba(255,255,255,0.1)', 'rgba(255,255,255,0.3)'],
          },
        },
        axisLine: {
          lineStyle: { color: dark ? CHART_COLORS.axisLine.dark : CHART_COLORS.axisLine.light },
        },
      },
      series: [
        {
          type: 'radar',
          symbolSize: 6,
          lineStyle: {
            width: 2,
            color: dark ? CHART_COLORS.accent.dark : CHART_COLORS.accent.light,
          },
          itemStyle: { color: dark ? CHART_COLORS.accent.dark : CHART_COLORS.accent.light },
          data: [
            {
              value: values,
              name: name,
              areaStyle: {
                opacity: 0.3,
                color: dark ? CHART_COLORS.accent.dark : CHART_COLORS.accent.light,
              },
            },
          ],
        },
      ],
    }
  }

  /** 点击设施名称（显示 POI 图层） */
  function handleFacilityClick(key: string): void {
    const props = getProps()

    if (activeFacilityType.value === key) {
      activeFacilityType.value = null
      emit('hide-facility-layer')
      return
    }

    activeFacilityType.value = key
    emit('show-facility-layer', {
      type: key,
      poiList: props.facilityPoi[key] || [],
      color: getFacilityColor(key),
      label: FACILITY_LABELS[key],
    })
  }

  // 统一图表生命周期委托 useECharts：init/dispose/resize/theme/watch 由它管理
  const { updateChart, getInstance } = useECharts({
    getOption: buildRadarOption,
    chartRef,
    recomputeOptionOnResize: true,
    onClick: (params) => {
      if (params.componentType === 'radar' && params.name) {
        const key = getProps().selectedTypes.find((k) => FACILITY_LABELS[k] === params.name)
        if (key) {
          handleFacilityClick(key)
        }
      }
    },
    watchSources: [
      () => getProps().xiaoqu,
      () => getProps().selectedTypes,
      () => getProps().facilityPoi,
    ],
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

  /** 设置 ResizeObserver：useECharts 已在 init 时内置 ResizeObserver，无需重复实现 */
  function setupResizeObserver(): void {
    void getInstance
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
    activeFacilityType,
    renderRadar,
    handleScoreClick,
    handleGlobalClick,
    setupResizeObserver,
  }
}
