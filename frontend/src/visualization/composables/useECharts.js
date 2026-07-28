// ECharts 通用 composable：封装实例初始化/更新/销毁
import { ref, onMounted, onUnmounted, watch } from 'vue'
import * as echarts from 'echarts/core'

// 注册必需组件（解决 "Component grid is used but not imported" 错误）
import {
  GridComponent,
  TitleComponent,
  LegendComponent,
  TooltipComponent,
} from 'echarts/components'
import { LineChart, BarChart } from 'echarts/charts'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([
  GridComponent,
  TitleComponent,
  LegendComponent,
  TooltipComponent,
  LineChart,
  BarChart,
  CanvasRenderer,
])

export function useECharts({ getOption, watchSources = [], onClick = null }) {
  const chartRef = ref(null)
  let chartInstance = null
  let resizeObserver = null

  /**
   * 初始化图表
   */
  function initChart() {
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
  function updateChart() {
    if (!chartInstance) return
    const option = getOption()
    chartInstance.setOption(option, { notMerge: false, lazyUpdate: true })
  }

  /**
   * 处理窗口大小变化
   */
  function handleResize() {
    chartInstance?.resize()
  }

  /**
   * 销毁图表实例
   */
  function disposeChart() {
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
