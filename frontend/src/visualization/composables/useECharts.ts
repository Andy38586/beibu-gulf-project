// ECharts 通用 composable：封装实例初始化/更新/销毁
import type { ECharts } from 'echarts'
import { BarChart, LineChart } from 'echarts/charts'
// 注册必需组件（解决 "Component grid is used but not imported" 错误）
import {
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
} from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import type { Ref, WatchSource } from 'vue'
import { onMounted, onUnmounted, ref, watch } from 'vue'

import { useTheme } from '@/shared'
import { perfTimeFn } from '@/shared/utils/perfReporter'

echarts.use([
  GridComponent,
  TitleComponent,
  LegendComponent,
  TooltipComponent,
  LineChart,
  BarChart,
  CanvasRenderer,
])

/** ECharts 点击事件回调参数（仅声明实际使用的字段） */
export interface ChartClickParams {
  componentType: string
  name?: string
  dataIndex?: number
}

/** useECharts 配置选项 */
export interface UseEChartsOptions {
  getOption: () => Record<string, unknown>
  watchSources?: WatchSource<unknown>[]
  onClick?: ((params: ChartClickParams) => void) | null
}

/** useECharts 返回值 */
export interface UseEChartsReturn {
  chartRef: Ref<HTMLElement | null>
  updateChart: () => void
  getInstance: () => ECharts | null
}

export function useECharts({
  getOption,
  watchSources = [],
  onClick = null,
}: UseEChartsOptions): UseEChartsReturn {
  const chartRef = ref<HTMLElement | null>(null)
  let chartInstance: ECharts | null = null
  let resizeObserver: ResizeObserver | null = null
  // 主题变化 → 重跑 getOption 重设（canvas 不支持 CSS 变量，需显式重设颜色）
  // 100ms 防抖合并快速连点；onUnmounted 清理订阅与定时器
  const { onThemeChange } = useTheme()
  let stopThemeWatch: (() => void) | null = null
  let themeTimer: ReturnType<typeof setTimeout> | null = null

  /**
   * 初始化图表
   */
  function initChart(): void {
    if (!chartRef.value) return

    chartInstance = echarts.init(chartRef.value)
    updateChart()

    if (onClick) {
      chartInstance.on('click', onClick)
    }

    window.addEventListener('resize', handleResize)
    // 容器尺寸变化（抽屉展开、面板重排、响应式布局）也要触发 resize；
    // 仅监听 window.resize 会在抽屉/流布局下失效，图表保持旧尺寸
    if (typeof ResizeObserver !== 'undefined' && chartRef.value) {
      resizeObserver = new ResizeObserver(() => handleResize())
      resizeObserver.observe(chartRef.value)
    }
  }

  /**
   * 更新图表配置
   * 增量更新模式（D-7，2026-08-06）：
   * - notMerge=false 保留现有配置（轴/图例/样式不重建）
   * - replaceMerge:['series'] 整体替换 series（防旧 series 残留导致闪烁/串线）
   * - lazyUpdate=true 延迟渲染，同一帧多次更新合并为一次
   * series 稳定 id 由 useChartBase 在 buildOption 中给出（seriesConfig.id 或 name 派生）
   */
  function updateChart(): void {
    if (!chartInstance) return
    const option = getOption()
    // perfTimeFn 闭包内 TS 无法收窄 chartInstance（const 收窄不跨箭头函数），先取局部常量
    const inst = chartInstance
    perfTimeFn('echarts:setOption', () => {
      inst.setOption(option, { notMerge: false, replaceMerge: ['series'], lazyUpdate: true })
    })
  }

  /**
   * 处理窗口大小变化
   */
  function handleResize(): void {
    chartInstance?.resize()
  }

  /**
   * 销毁图表实例
   */
  function disposeChart(): void {
    window.removeEventListener('resize', handleResize)
    if (resizeObserver) {
      resizeObserver.disconnect()
      resizeObserver = null
    }
    if (onClick && chartInstance) {
      chartInstance.off('click', onClick)
    }
    chartInstance?.dispose()
    chartInstance = null
    stopThemeWatch?.()
    stopThemeWatch = null
    if (themeTimer) {
      clearTimeout(themeTimer)
      themeTimer = null
    }
  }

  onMounted(() => {
    initChart()
    stopThemeWatch = onThemeChange(() => {
      if (themeTimer) clearTimeout(themeTimer)
      themeTimer = setTimeout(() => {
        themeTimer = null
        updateChart()
      }, 100)
    })
  })
  onUnmounted(disposeChart)

  // 监听数据源变化
  if (watchSources.length > 0) {
    watch(watchSources, updateChart)
  }

  return {
    chartRef,
    updateChart,
    getInstance: () => chartInstance,
  }
}
