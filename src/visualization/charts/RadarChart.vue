<script setup>
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

const props = defineProps({
  visible: { type: Boolean, default: true },
  xiaoqu: { type: Object, default: null },
  selectedTypes: { type: Array, default: () => [] },
  embedded: { type: Boolean, default: false },
  facilityPoi: { type: Object, default: () => ({}) },
})

const emit = defineEmits(['close', 'show-facility-layer', 'hide-facility-layer'])

const chartRef = ref(null)
const panelRef = ref(null)
let chartInstance = null
let resizeObserver = null
let isRendering = false

const { cellPixel } = useGCS()
const unitPx = computed(() => cellPixel.value * 0.1)
/** 0.2 cell 间距 */
const spacingPx = computed(() => cellPixel.value * 0.2)

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
  if (chartInstance) {
    chartInstance.dispose()
    chartInstance = null
  }
  chartInstance = echarts.init(chartRef.value)

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

  // 监听雷达图点击事件（轴名称点击）
  chartInstance.on('click', (params) => {
    if (params.componentType === 'radar' && params.name) {
      const key = props.selectedTypes.find((k) => FACILITY_LABELS[k] === params.name)
      if (key) {
        handleFacilityClick(key)
      }
    }
  })

  isRendering = false
}

/** 点击综合评分 */
function handleScoreClick() {
  if (tooltipVisible.value) {
    tooltipVisible.value = false
    return
  }

  // 定位到评分文字上方，水平居中（Teleport 到 body，用视口坐标）
  // 弹窗尺寸：2×3 cell
  const tooltipW = cellPixel.value * 2
  const tooltipH = cellPixel.value * 3
  const scoreEl = document.querySelector('.score-text')
  if (scoreEl) {
    const rect = scoreEl.getBoundingClientRect()
    let left = rect.left + rect.width / 2 - tooltipW / 2
    let top = rect.top - tooltipH - 8

    // 边界检测：确保弹窗在视口内
    const viewportW = window.innerWidth
    const viewportH = window.innerHeight

    // 水平居中，但不超出左右边界
    if (left < 10) left = 10
    if (left + tooltipW > viewportW - 10) left = viewportW - tooltipW - 10

    // 如果上方空间不够，显示在下方
    if (top < 10) {
      top = rect.bottom + 8
    }

    // 如果下方也不够，确保至少显示在视口内
    if (top + tooltipH > viewportH - 10) {
      top = viewportH - tooltipH - 10
    }

    tooltipPosition.value = { left, top }
    tooltipVisible.value = true
  }
}

/** 点击其他地方关闭浮窗 */
function handleGlobalClick(e) {
  const tooltipEl = document.querySelector('.radar-tooltip')
  const scoreEl = document.querySelector('.score-text')
  
  if (tooltipVisible.value && tooltipEl && !tooltipEl.contains(e.target) && !scoreEl?.contains(e.target)) {
    tooltipVisible.value = false
  }
}

/** 点击设施名称（显示POI图层） */
function handleFacilityClick(key) {
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

function handleResize() {
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

watch([() => props.xiaoqu, () => props.selectedTypes, () => props.facilityPoi], () => {
  setupResizeObserver()
  nextTick(() => renderRadar())
}, {
  flush: 'post',
})

/** 设置 ResizeObserver */
function setupResizeObserver() {
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

    <!-- 具体得分浮窗（Teleport 到 body，2×3 cell 面板） -->
    <Teleport to="body">
      <div
        v-if="tooltipVisible && xiaoqu && selectedTypes.length > 0"
        class="radar-tooltip"
        :style="{
          left: tooltipPosition.left + 'px',
          top: tooltipPosition.top + 'px',
        }"
      >
        <div class="tooltip-grid">
          <div
            v-for="key in selectedTypes"
            :key="key"
            class="tooltip-item"
            :style="{ color: getFacilityColor(key) }"
          >
            <span class="tooltip-label">{{ FACILITY_LABELS[key] }}</span>
            <span class="tooltip-value">{{ xiaoqu.breakdown?.[key] ?? 0 }}分</span>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.radar-panel {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: calc(2 * v-bind(unitPx)) calc(1.5 * v-bind(unitPx));
  box-sizing: border-box;
  position: relative;
}

/* 小区名称：顶部居中，距 panel 顶部 0.2 cell */
.xiaoqu-name {
  font-size: 14px;
  font-weight: 500;
  color: #333;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: calc(0.5 * v-bind(unitPx));
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

/* 综合评分：与 panel 底部间距由 .radar-panel 的 padding 控制（0.2 cell） */
.score-text {
  color: #409eff;
  font-weight: 500;
  margin: 0;
  font-size: 14px;
  text-align: center;
}

.score-text.clickable {
  cursor: pointer;
  transition: color 0.2s;
}

.score-text.clickable:hover {
  color: #66b1ff;
}

/* 具体得分浮窗（Teleport 到 body，用 fixed 定位，2×3 cell） */
.radar-tooltip {
  position: fixed;
  z-index: 1000;
  background: rgba(255, 255, 255, 0.98);
  border: 1px solid #e0e0e0;
  border-radius: calc(1 * v-bind(unitPx));
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
  width: calc(20 * v-bind(unitPx));
  height: calc(30 * v-bind(unitPx));
  box-sizing: border-box;
}

/* 1列×6行网格布局，撑满整个弹窗 */
.tooltip-grid {
  display: grid;
  grid-template-columns: 1fr;
  grid-template-rows: repeat(6, 1fr);
  width: 100%;
  height: 100%;
}

.tooltip-item {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 0 calc(1 * v-bind(unitPx));
  font-size: 15px;
  border-bottom: 1px solid #f0f0f0;
}

.tooltip-item:last-child {
  border-bottom: none;
}

.tooltip-label {
  font-weight: 500;
  font-size: 14px;
}

.tooltip-value {
  font-weight: 600;
  font-size: 15px;
}
</style>
