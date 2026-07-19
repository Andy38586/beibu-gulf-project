<script setup lang="ts">
/**
 * RadarChart - 雷达图面板（简化版）
 *
 * 布局：
 * - 顶部居中：小区名称
 * - 中部：雷达图（左右居中、上下居中，保持原大小）
 * - 底部：综合评分（蓝色字体，可点击）
 *
 * 交互：
 * 1. 点击综合评分 → 在评分上方弹出具体得分（1列6行）
 * 2. 点击其他地方关闭浮窗
 * 3. 点击雷达图轴名称 → 显示该设施POI图层（互斥）
 */

import { ref, watch, onMounted, onBeforeUnmount, nextTick, computed } from 'vue'
import * as echarts from 'echarts/core'
import { RadarChart as EChartsRadarChart } from 'echarts/charts'
import { TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

// 注册 ECharts 组件
echarts.use([EChartsRadarChart, TooltipComponent, CanvasRenderer])
import { FACILITY_LABELS } from '@/shared/utils/facilityLabels'
import { FACILITY_CONFIG } from '@/business/site-selection/composables/useFacilities'
import { useGCS } from '@/core/layout/useGCS.js'
import RadarScoreTooltip from './components/RadarScoreTooltip.vue'
import type { ScoredXiaoqu } from '@/types/xiaoqu'
import type { FacilityPoint, FacilityType } from '@/types/facility'
import type { ECharts } from 'echarts'

interface Props {
  visible: boolean
  xiaoqu: ScoredXiaoqu | null
  selectedTypes: string[]
  embedded: boolean
  facilityPoi: Record<string, FacilityPoint[]>
}

interface Emits {
  (e: 'close'): void
  (e: 'show-facility-layer', data: {
    type: string
    poiList: FacilityPoint[]
    color: string
    label: string
  }): void
  (e: 'hide-facility-layer'): void
}

const props = withDefaults(defineProps<Props>(), {
  visible: true,
  xiaoqu: null,
  selectedTypes: () => [],
  embedded: false,
  facilityPoi: () => ({})
})

const emit = defineEmits<Emits>()

const chartRef = ref<HTMLElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)
let chartInstance: ECharts | null = null
let resizeObserver: ResizeObserver | null = null
let isRendering = false

const { cellPixel } = useGCS()
const unitPx = computed(() => cellPixel.value * 0.1)
/** 0.2 cell 间距 */
const spacingPx = computed(() => cellPixel.value * 0.2)

/** 弹窗尺寸：2×3 cell（Teleport 到 body 后 v-bind 失效，用 inline style） */
const tooltipW = computed(() => cellPixel.value * 2)
const tooltipH = computed(() => cellPixel.value * 3)

/** 浮窗状态 */
const tooltipVisible = ref<boolean>(false)
const tooltipPosition = ref<{ left: number; top: number }>({ left: 0, top: 0 })

/** 当前选中的设施类型 */
const activeFacilityType = ref<string | null>(null)

/** 获取设施颜色 */
function getFacilityColor(key: string): string {
  return FACILITY_CONFIG[key as FacilityType]?.color || '#666'
}

/** 渲染雷达图 */
function renderRadar(): void {
  if (!chartRef.value || isRendering) return
  // 确保容器有实际尺寸再初始化
  const w = chartRef.value.clientWidth
  const h = chartRef.value.clientHeight
  if (w < 10 || h < 10) {
    // 容器尺寸为 0，延迟重试（setTimeout 比 rAF 更可靠）
    setTimeout(() => renderRadar(), 100)
    return
  }
  isRendering = true
  
  // AUDIT-315-004: 复用ECharts实例，避免频繁销毁重建
  if (!chartInstance) {
    chartInstance = echarts.init(chartRef.value)
    
    // 监听雷达图点击事件（轴名称点击）- 只需绑定一次
    chartInstance.on('click', (params: any) => {
      if (params.componentType === 'radar' && params.name) {
        const key = props.selectedTypes.find((k) => FACILITY_LABELS[k as FacilityType] === params.name)
        if (key) {
          handleFacilityClick(key)
        }
      }
    })
  }

  const indicators = props.selectedTypes.map((key) => ({
    name: FACILITY_LABELS[key as FacilityType] || key,
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
function handleScoreClick(): void {
  if (tooltipVisible.value) {
    tooltipVisible.value = false
    return
  }

  // 定位到评分文字上方，水平居中（Teleport 到 body，用视口坐标）
  const scoreEl = document.querySelector('.score-text')
  if (scoreEl) {
    const rect = scoreEl.getBoundingClientRect()
    let left = rect.left + rect.width / 2 - tooltipW.value / 2
    let top = rect.top - tooltipH.value - 8

    // 边界检测：确保弹窗在视口内
    const viewportW = window.innerWidth
    const viewportH = window.innerHeight

    // 水平居中，但不超出左右边界
    if (left < 10) left = 10
    if (left + tooltipW.value > viewportW - 10) left = viewportW - tooltipW.value - 10

    // 如果上方空间不够，显示在下方
    if (top < 10) {
      top = rect.bottom + 8
    }

    // 如果下方也不够，确保至少显示在视口内
    if (top + tooltipH.value > viewportH - 10) {
      top = viewportH - tooltipH.value - 10
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
    !tooltipEl.contains(e.target) &&
    !scoreEl?.contains(e.target)
  ) {
    tooltipVisible.value = false
  }
}

/** 点击设施名称（显示POI图层） */
function handleFacilityClick(key: string): void {
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
    label: FACILITY_LABELS[key as FacilityType],
  })
}

watch(
  () => tooltipVisible.value,
  (val) => {
    if (val) {
      setTimeout(() => window.addEventListener('click', handleGlobalClick), 100)
    } else {
      window.removeEventListener('click', handleGlobalClick)
    }
  },
)

function handleResize(): void {
  chartInstance?.resize()
}

watch(
  () => props.visible,
  (val) => {
    if (val) {
      nextTick(() => renderRadar())
    }
  },
)

watch(
  [() => props.xiaoqu, () => props.selectedTypes, () => props.facilityPoi],
  () => {
    setupResizeObserver()
    nextTick(() => renderRadar())
  },
  {
    flush: 'post',
  },
)

/** 设置 ResizeObserver */
function setupResizeObserver(): void {
  resizeObserver?.disconnect()
  if (chartRef.value) {
    resizeObserver = new ResizeObserver(() => {
      nextTick(() => renderRadar())
    })
    resizeObserver.observe(chartRef.value)
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
</script>

<template>
  <div ref="panelRef" class="radar-panel">
    <!-- 顶部：小区名称 -->
    <div v-if="xiaoqu" class="xiaoqu-name">{{ xiaoqu.name }}</div>

    <!-- 中部：雷达图容器 -->
    <div class="radar-container">
      <div v-if="xiaoqu" ref="chartRef" class="radar-chart"></div>
      <div v-else class="empty-state">请在结果列表中选择小区查看雷达图</div>
    </div>

    <!-- 底部：综合评分（可点击） -->
    <div v-if="xiaoqu" class="score-text clickable" @click.stop="handleScoreClick">
      综合评分：{{ xiaoqu.score }}
    </div>

    <!-- 具体得分浮窗（使用子组件） -->
    <RadarScoreTooltip
      :visible="tooltipVisible"
      :xiaoqu="xiaoqu"
      :selectedTypes="selectedTypes"
      :position="tooltipPosition"
    />
  </div>
</template>

<style scoped>
.radar-panel {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 0;
  box-sizing: border-box;
  position: relative;
}

/* 小区名称：距 panel 顶部 0.2 cell */
.xiaoqu-name {
  font-size: 14px;
  font-weight: 500;
  color: #333;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: calc(2 * v-bind(unitPx));
  margin-bottom: calc(2 * v-bind(unitPx));
}

/* 雷达图容器：flex 占满剩余空间，内部用 absolute 确保 ECharts 有确定尺寸 */
.radar-container {
  flex: 1;
  min-height: 0;
  position: relative;
}

.radar-chart {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
}

.empty-state {
  color: #999;
  font-size: 13px;
  text-align: center;
}

/* 综合评分：距雷达图 0.2 cell，距 panel 底部 0.2 cell */
.score-text {
  color: #409eff;
  font-weight: 500;
  margin: 0;
  font-size: 14px;
  text-align: center;
  margin-top: calc(2 * v-bind(unitPx));
  margin-bottom: calc(2 * v-bind(unitPx));
}

.score-text.clickable {
  cursor: pointer;
  transition: color 0.2s;
}

.score-text.clickable:hover {
  color: #66b1ff;
}
</style>
