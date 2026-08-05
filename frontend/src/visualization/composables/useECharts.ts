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
   * 使用增量更新模式：notMerge=false 保留现有配置，lazyUpdate=true 延迟渲染提升性能
   */
  function updateChart(): void {
    if (!chartInstance) return
    const option = getOption()
    // perfTimeFn 闭包内 TS 无法收窄 chartInstance（const 收窄不跨箭头函数），先取局部常量
    const inst = chartInstance
    perfTimeFn('echarts:setOption', () => {
      inst.setOption(option, { notMerge: false, lazyUpdate: true })
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
  }

  onMounted(initChart)
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
