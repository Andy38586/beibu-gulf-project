/**
 * useRadarChart - 雷达图逻辑 composable
 * 职责：封装雷达图的渲染、交互和事件处理逻辑
 * RadarChart.vue 过大问题
 * @param options - 配置选项
 * @param options.getChartRef - 获取图表 DOM 元素
 * @param options.getProps - 获取组件 props
 * @param options.emit - 事件发射器
 * @returns - 返回雷达图相关的方法和状态
 */
import type { ECharts } from 'echarts'
import { RadarChart as EChartsRadarChart } from 'echarts/charts'
import { TooltipComponent } from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import type { Ref } from 'vue'
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

import { perfMark, perfMeasure } from '@/core/perf/PerfReporter'
import { FACILITY_COLORS_MAP } from '@/shared'
import { FACILITY_LABELS } from '@/shared'
import { logger } from '@/shared'
import type { FacilityPoint } from '@/types/facility'
import type { ScoredXiaoqu } from '@/types/xiaoqu'

// 注册 ECharts 组件
echarts.use([EChartsRadarChart, TooltipComponent, CanvasRenderer])

/** 雷达图所需 props 子集（来自 RadarChart.vue） */
interface RadarChartProps {
  xiaoqu: ScoredXiaoqu | null
  selectedTypes: string[]
  facilityPoi: Record<string, FacilityPoint[]>
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
  getChartRef: () => HTMLElement | null
  getProps: () => RadarChartProps
  emit: RadarChartEmit
}

/** 浮窗位置 */
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
  getChartRef,
  getProps,
  emit,
}: UseRadarChartOptions): UseRadarChartReturn {
  let chartInstance: ECharts | null = null
  let resizeObserver: ResizeObserver | null = null
  let isRendering = false

  /** 浮窗状态 */
  const tooltipVisible = ref<boolean>(false)
  const tooltipPosition = ref<TooltipPosition>({ left: 0, top: 0 })

  /** 当前选中的设施类型 */
  const activeFacilityType = ref<string | null>(null)

  /** 获取设施颜色（从 shared 色值映射取，不依赖 business 层） */
  function getFacilityColor(key: string): string {
    return FACILITY_COLORS_MAP[key] || '#666'
  }

  /** 渲染雷达图 */
  function renderRadar(): void {
    const chartRef = getChartRef()
    const props = getProps()

    if (!chartRef || isRendering) return

    const w = chartRef.clientWidth
    const h = chartRef.clientHeight

    // 容器尺寸不足时重试，最多重试10次（1秒）
    if (w < 10 || h < 10) {
      const container = chartRef as RadarChartContainer
      const retryCount = (container._radar_retryCount || 0) + 1
      if (retryCount > 10) {
        logger.debug('雷达图容器尺寸持续不足，放弃渲染')
        return
      }
      container._radar_retryCount = retryCount
      setTimeout(() => renderRadar(), 100)
      return
    }
    // 重置重试计数
    const container = chartRef as RadarChartContainer
    if (container._radar_retryCount) {
      container._radar_retryCount = 0
    }

    isRendering = true

    if (!chartInstance) {
      chartInstance = echarts.init(chartRef)

      chartInstance.on('click', (params) => {
        if (params.componentType === 'radar' && params.name) {
          const key = props.selectedTypes.find((k) => FACILITY_LABELS[k] === params.name)
          if (key) {
            handleFacilityClick(key)
          }
        }
      })
    }

    const indicators = props.selectedTypes.map((key) => ({
      name: FACILITY_LABELS[key] || key,
      max: 100,
    }))

    const values = props.selectedTypes.map((key) => props.xiaoqu?.breakdown?.[key] ?? 0)

    const name = props.xiaoqu?.name || ''

    perfMark('echarts:radar:start')
    chartInstance.setOption({
      backgroundColor: 'transparent',
      tooltip: { show: false },
      radar: {
        indicator: indicators,
        radius: '75%',
        center: ['50%', '50%'],
        axisName: {
          color: '#409eff',
          fontSize: 12,
          fontWeight: 500,
          cursor: 'pointer',
        },
        splitLine: { lineStyle: { color: '#eee' } },
        splitArea: {
          areaStyle: {
            color: ['rgba(255,255,255,0.1)', 'rgba(255,255,255,0.3)'],
          },
        },
        axisLine: { lineStyle: { color: '#ddd' } },
      },
      series: [
        {
          type: 'radar',
          symbolSize: 6,
          lineStyle: { width: 2, color: '#409eff' },
          itemStyle: { color: '#409eff' },
          data: [
            {
              value: values,
              name: name,
              areaStyle: { opacity: 0.3, color: '#409eff' },
            },
          ],
        },
      ],
    })
    perfMark('echarts:radar:end')
    perfMeasure('echarts:setOption:radar', 'echarts:radar:start', 'echarts:radar:end')

    isRendering = false
  }

  /** 点击综合评分 */
  function handleScoreClick(): void {
    if (tooltipVisible.value) {
      tooltipVisible.value = false
      return
    }

    const scoreEl = document.querySelector('.score-text')
    if (scoreEl) {
      const rect = scoreEl.getBoundingClientRect()
      let left = rect.left + rect.width / 2 - 160
      let top = rect.top - 240 - 8

      const viewportW = window.innerWidth
      const viewportH = window.innerHeight

      if (left < 10) left = 10
      if (left + 320 > viewportW - 10) left = viewportW - 320 - 10

      if (top < 10) {
        top = rect.bottom + 8
      }

      if (top + 240 > viewportH - 10) {
        top = viewportH - 240 - 10
      }

      tooltipPosition.value = { left, top }
      tooltipVisible.value = true
    }
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

  function handleResize(): void {
    chartInstance?.resize()
  }

  /** 设置 ResizeObserver */
  function setupResizeObserver(): void {
    const chartRef = getChartRef()

    resizeObserver?.disconnect()
    if (chartRef) {
      resizeObserver = new ResizeObserver(() => {
        void nextTick(() => renderRadar())
      })
      resizeObserver.observe(chartRef)
    }
  }

  onMounted(() => {
    window.addEventListener('resize', handleResize)
    setupResizeObserver()
  })

  onBeforeUnmount(() => {
    chartInstance?.dispose()
    chartInstance = null
    window.removeEventListener('click', handleGlobalClick)
    window.removeEventListener('resize', handleResize)
    resizeObserver?.disconnect()
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
