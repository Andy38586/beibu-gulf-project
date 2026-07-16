<script setup>
/**
 * RadarFloatPanel - 雷达图面板
 *
 * 支持两种模式：
 * - 浮动模式（默认）：v-if 控制显示，绝对定位，跟随 layer-panel 下方。
 * - 嵌入模式（embedded=true）：作为 Zone2 固定面板，始终渲染，无数据时显示占位。
 */

import { ref, watch, onBeforeUnmount, nextTick, computed } from 'vue'
import * as echarts from 'echarts'
import { FACILITY_LABELS } from '@/shared/utils/facilityLabels'
import { useGCS } from '@/core/layout/useGCS.js'

const props = defineProps({
  visible: { type: Boolean, default: true },
  xiaoqu: { type: Object, default: null },
  selectedTypes: { type: Array, default: () => [] },
  embedded: { type: Boolean, default: false },
})
const emit = defineEmits(['close'])

const chartRef = ref(null)
const panelRef = ref(null)
let chartInstance = null
let positionObserver = null
let resizeObserver = null

const { cellPixel } = useGCS()
/** 旧版 --unit=8px，现以 CELL_PIXEL 的 1/10 作为等效单位，保证视觉一致 */
const unitPx = computed(() => cellPixel.value * 0.1)

function renderRadar() {
  if (!props.xiaoqu || !chartRef.value) return
  if (chartInstance) {
    chartInstance.dispose()
    chartInstance = null
  }
  chartInstance = echarts.init(chartRef.value)
  const indicators = props.selectedTypes.map((key) => ({
    name: FACILITY_LABELS[key] || key,
    max: 100,
  }))
  const values = props.selectedTypes.map((key) => props.xiaoqu.breakdown?.[key] ?? 0)
  chartInstance.setOption({
    tooltip: {},
    radar: {
      indicator: indicators,
      radius: '65%',
      axisName: { fontSize: 12 },
    },
    series: [
      {
        type: 'radar',
        symbolSize: 6,
        lineStyle: { width: 2 },
        data: [
          {
            value: values,
            name: props.xiaoqu.name,
            areaStyle: { opacity: 0.3 },
          },
        ],
      },
    ],
  })
}

function handleResize() {
  chartInstance?.resize()
}

function updatePosition() {
  if (props.embedded || !panelRef.value) return
  const layerPanel = document.querySelector('.layer-panel')
  const panelRect = panelRef.value.getBoundingClientRect()
  const panelHeight = panelRect.height
  const unit = unitPx.value

  let topPosition = 9 * unit
  if (layerPanel) {
    const rect = layerPanel.getBoundingClientRect()
    topPosition = rect.bottom + 1.5 * unit
  }

  const maxTop = window.innerHeight - panelHeight - 2 * unit
  panelRef.value.style.top = `${Math.min(topPosition, maxTop)}px`
}

function handleClose() {
  emit('close')
}

function setupObservers() {
  if (props.embedded) return
  positionObserver = new ResizeObserver(updatePosition)
  const layerPanel = document.querySelector('.layer-panel')
  if (layerPanel) positionObserver.observe(layerPanel)
  resizeObserver = new ResizeObserver(handleResize)
  if (panelRef.value) resizeObserver.observe(panelRef.value)
  window.addEventListener('resize', handleResize)
}

function cleanupObservers() {
  try {
    positionObserver?.disconnect()
  } catch {}
  positionObserver = null
  try {
    resizeObserver?.disconnect()
  } catch {}
  resizeObserver = null
  window.removeEventListener('resize', handleResize)
}

watch(
  () => props.visible,
  (val) => {
    if (val) {
      nextTick(() => {
        updatePosition()
        renderRadar()
        setupObservers()
      })
    } else {
      cleanupObservers()
    }
  },
)

watch([() => props.xiaoqu, () => props.selectedTypes], renderRadar, { flush: 'post' })

onBeforeUnmount(() => {
  chartInstance?.dispose()
  chartInstance = null
  cleanupObservers()
})
</script>

<template>
  <!-- 浮动模式：保持原有行为 -->
  <div v-if="!embedded && visible && xiaoqu" ref="panelRef" class="radar-float-panel">
    <div class="panel-header">
      <strong>{{ xiaoqu.name }}</strong>
      <button class="close-btn" @click="handleClose">×</button>
    </div>
    <p class="score-text">综合评分：{{ xiaoqu.score }}</p>
    <div ref="chartRef" class="radar-chart"></div>
  </div>

  <!-- 嵌入模式：作为 Zone2 固定面板 -->
  <div v-else-if="embedded" ref="panelRef" class="radar-embedded">
    <template v-if="xiaoqu">
      <div class="panel-header">
        <strong>{{ xiaoqu.name }}</strong>
      </div>
      <p class="score-text">综合评分：{{ xiaoqu.score }}</p>
      <div ref="chartRef" class="radar-chart"></div>
    </template>
    <div v-else class="empty-state">
      <span>请在结果列表中选择小区查看雷达图</span>
    </div>
  </div>
</template>

<style scoped>
/* 浮动模式：与旧版保持一致 */
.radar-float-panel {
  position: absolute;
  left: calc(1.25 * v-bind(unitPx));
  width: calc(39 * v-bind(unitPx));
  z-index: 95;
  background: rgba(255, 255, 255, 0.98);
  border-radius: calc(1.25 * v-bind(unitPx));
  box-shadow: 0 calc(0.5 * v-bind(unitPx)) calc(2.25 * v-bind(unitPx)) rgba(0, 0, 0, 0.2);
  padding: calc(1.5 * v-bind(unitPx));
  display: flex;
  flex-direction: column;
  gap: v-bind(unitPx);
  clip-path: inset(0 0 0 0 round calc(1.25 * v-bind(unitPx)));
}

/* 嵌入模式：填满 Zone2 */
.radar-embedded {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: v-bind(unitPx);
  background: rgba(255, 255, 255, 0.98);
  border-radius: calc(1.25 * v-bind(unitPx));
  box-shadow: 0 calc(0.5 * v-bind(unitPx)) calc(2.25 * v-bind(unitPx)) rgba(0, 0, 0, 0.2);
  padding: calc(1.5 * v-bind(unitPx));
  box-sizing: border-box;
  clip-path: inset(0 0 0 0 round calc(1.25 * v-bind(unitPx)));
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: v-bind(unitPx);
  border-bottom: 1px solid #eee;
}
.panel-header strong {
  font-size: 14px;
  color: #333;
}
.close-btn {
  background: none;
  border: none;
  font-size: 18px;
  cursor: pointer;
  color: #999;
  line-height: 1;
  padding: 0;
}
.score-text {
  color: #27ae60;
  font-weight: 500;
  margin: 0;
  font-size: 13px;
}
.radar-chart {
  width: 100%;
  flex: 1;
  min-height: 0;
}
.empty-state {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #999;
  font-size: 13px;
  text-align: center;
}
</style>
