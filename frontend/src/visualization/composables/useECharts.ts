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
  /** 外部传入的图表容器 ref（如模板条件渲染 v-if 下的元素）。缺省时内部自建 */
  chartRef?: Ref<HTMLElement | null>
  /** 容器尺寸变化（resize / ResizeObserver）时是否重算 getOption。用于依赖容器尺寸的 option（如雷达 radius） */
  recomputeOptionOnResize?: boolean
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
  chartRef: externalChartRef,
  recomputeOptionOnResize = false,
}: UseEChartsOptions): UseEChartsReturn {
  // 外部传入时复用它，否则内部自建（模板 v-if 场景 chartRef 需与组件绑定同一引用）
  const chartRef = externalChartRef ?? ref<HTMLElement | null>(null)
  let chartInstance: ECharts | null = null
  let resizeObserver: ResizeObserver | null = null
  // 主题变化时重跑 getOption 重设颜色（canvas 不支持 CSS 变量）；100ms 防抖合并快速连点，卸载时清理
  const { onThemeChange } = useTheme()
  let stopThemeWatch: (() => void) | null = null
  let themeTimer: ReturnType<typeof setTimeout> | null = null

  /**
   * 初始化图表
   */
  function initChart(): void {
    if (!chartRef.value) return
    // 幂等守卫：同一容器已初始化过则跳过（v-if 重新挂载时 watch chartRef 会再次触发）
    if (chartInstance) return

    chartInstance = echarts.init(chartRef.value)
    updateChart()

    if (onClick) {
      chartInstance.on('click', onClick)
    }

    window.addEventListener('resize', handleResize)
    // 容器尺寸变化（抽屉展开、面板重排、响应式布局）也需触发 resize：仅 window.resize 在流式布局下会失效
    if (typeof ResizeObserver !== 'undefined' && chartRef.value) {
      resizeObserver = new ResizeObserver(() => handleResize())
      resizeObserver.observe(chartRef.value)
    }
  }

  /** 更新图表配置：增量更新（notMerge 保留轴/样式，replaceMerge 整体替换 series 防残留，lazyUpdate 合并渲染） */
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
    // 依赖容器尺寸的 option（如雷达 radius）需在 resize 后重算再应用，否则图形不随容器缩放
    if (recomputeOptionOnResize) {
      updateChart()
    }
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

  // 外部 chartRef 动态挂载：v-if 条件渲染（如雷达图 xiaoqu 为空时容器不存在）下，
  // onMounted 时 chartRef 尚为 null，需在容器由空变非空时补初始化
  watch(chartRef, (el) => {
    if (el) initChart()
  })

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
