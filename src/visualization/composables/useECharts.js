/**
 * useECharts - ECharts 通用 composable
 * 
 * 职责：封装 ECharts 实例的初始化、更新、销毁逻辑
 * 解决 AUDIT-002(架构)：图表组件重复逻辑问题
 * 
 * @param {Object} options - 配置选项
 * @param {Function} options.getOption - 获取 ECharts option 的函数
 * @param {Array} options.watchSources - 需要监听的数据源数组
 * @param {Function} options.onClick - 点击事件处理函数（可选）
 * @returns {Object} - 返回 chartRef、updateChart、getInstance
 */
import { ref, onMounted, onUnmounted, watch } from 'vue'
import * as echarts from 'echarts/core'

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
    chartInstance.setOption(option, true)
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
