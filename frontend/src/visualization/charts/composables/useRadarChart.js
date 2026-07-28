/**
 * useRadarChart - 雷达图逻辑 composable
 *
 * 职责：封装雷达图的渲染、交互和事件处理逻辑
 * RadarChart.vue 过大问题
 *
 * @param {Object} options - 配置选项
 * @param {Function} options.getChartRef - 获取图表 DOM 元素
 * @param {Function} options.getProps - 获取组件 props
 * @param {Function} options.emit - 事件发射器
 * @returns {Object} - 返回雷达图相关的方法和状态
 */
import { ref, nextTick, onMounted, onBeforeUnmount } from 'vue'
import * as echarts from 'echarts/core'
import { RadarChart as EChartsRadarChart } from 'echarts/charts'
import { TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { FACILITY_LABELS } from '@/shared/utils/facilityLabels'
import { FACILITY_CONFIG } from '@/business/site-selection/composables/facilityConfig'

// 注册 ECharts 组件
echarts.use([EChartsRadarChart, TooltipComponent, CanvasRenderer])

export function useRadarChart({ getChartRef, getProps, emit }) {
  let chartInstance = null
  let resizeObserver = null
  let isRendering = false

  /** 浮窗状态 */
  const tooltipVisible = ref(false)
  const tooltipPosition = ref({ left: 0, top: 0 })

  /** 当前选中的设施类型 */
  const activeFacilityType = ref(null)

  /** 获取设施颜色 */
  function getFacilityColor(key) {
    return FACILITY_CONFIG[key]?.color || '#666'
  }

  /** 渲染雷达图 */
  function renderRadar() {
    const chartRef = getChartRef()
    const props = getProps()

    if (!chartRef || isRendering) return

    const w = chartRef.clientWidth
    const h = chartRef.clientHeight

    // 容器尺寸不足时重试，最多重试10次（1秒）
    if (w < 10 || h < 10) {
      const retryCount = (chartRef._radarRetryCount || 0) + 1
      if (retryCount > 10) {
        if (import.meta.env.DEV) {
          console.warn('雷达图容器尺寸持续不足，放弃渲染')
        }
        return
      }
      chartRef._radarRetryCount = retryCount
      setTimeout(() => renderRadar(), 100)
      return
    }
    // 重置重试计数
    if (chartRef._radarRetryCount) {
      chartRef._radarRetryCount = 0
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

    isRendering = false
  }

  /** 点击综合评分 */
  function handleScoreClick() {
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
  function handleGlobalClick(e) {
    const tooltipEl = document.querySelector('.radar-tooltip')
    const scoreEl = document.querySelector('.score-text')

    if (
      tooltipVisible.value &&
      tooltipEl &&
      !tooltipEl.contains(e.target) &&
      !scoreEl?.contains(e.target)
    ) {
      tooltipVisible.value = false
    }
  }

  /** 点击设施名称（显示 POI 图层） */
  function handleFacilityClick(key) {
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

  function handleResize() {
    chartInstance?.resize()
  }

  /** 设置 ResizeObserver */
  function setupResizeObserver() {
    const chartRef = getChartRef()

    resizeObserver?.disconnect()
    if (chartRef) {
      resizeObserver = new ResizeObserver(() => {
        nextTick(() => renderRadar())
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
