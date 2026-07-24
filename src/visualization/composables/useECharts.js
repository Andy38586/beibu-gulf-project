// ECharts 通用 composable：封装实例初始化/更新/销毁
import { ref, onMounted, onUnmounted, watch } from 'vue'
import * as echarts from 'echarts/core'

// FIX:P3-09: 注册必需组件（解决 "Component grid is used but not imported" 错误）
import { 
  GridComponent, 
  TitleComponent, 
  LegendComponent, 
  TooltipComponent 
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
  }

  /**
   * 更新图表配置
   */
  function updateChart() {
    if (!chartInstance) return
    const option = getOption()
    chartInstance.setOption(option, false)
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
