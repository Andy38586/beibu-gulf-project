<script setup>
import { ref, watch, onBeforeUnmount, nextTick } from 'vue'
import * as echarts from 'echarts'
import { FACILITY_LABELS } from '@/composables/facilityLabels'

const props = defineProps({
  visible: Boolean,
  xiaoqu: Object,
  selectedTypes: Array,
})
const emit = defineEmits(['close'])

const chartRef = ref(null)
const panelRef = ref(null)
let chartInstance = null
let positionObserver = null
let resizeObserver = null
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
      axisName: {
        fontSize: 12,
      },
    },
    series: [
      {
        type: 'radar',
        symbolSize: 6,
        lineStyle: {
          width: 2,
        },
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

function getUnitSize() {
  const root = document.documentElement
  return parseFloat(getComputedStyle(root).getPropertyValue('--unit')) || 8
}

function updatePosition() {
  if (!panelRef.value) return
  const layerPanel = document.querySelector('.layer-panel')
  const panelRect = panelRef.value.getBoundingClientRect()
  const panelHeight = panelRect.height
  const unit = getUnitSize()

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
watch(
  () => props.visible,
  (val) => {
    if (val) {
      nextTick(() => {
        updatePosition()
        renderRadar()
        positionObserver = new ResizeObserver(updatePosition)
        const layerPanel = document.querySelector('.layer-panel')
        if (layerPanel) {
          positionObserver.observe(layerPanel)
        }
        resizeObserver = new ResizeObserver(handleResize)
        if (panelRef.value) {
          resizeObserver.observe(panelRef.value)
        }
        window.addEventListener('resize', handleResize)
      })
    } else {
      if (positionObserver) {
        positionObserver.disconnect()
        positionObserver = null
      }
      if (resizeObserver) {
        resizeObserver.disconnect()
        resizeObserver = null
      }
      window.removeEventListener('resize', handleResize)
    }
  },
)

watch([() => props.xiaoqu, () => props.selectedTypes], renderRadar, { flush: 'post' })

onBeforeUnmount(() => {
  chartInstance?.dispose()
  chartInstance = null
  if (positionObserver) {
    positionObserver.disconnect()
    positionObserver = null
  }
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
  window.removeEventListener('resize', handleResize)
})
</script>

<template>
  <div v-if="visible && xiaoqu" ref="panelRef" class="radar-float-panel">
    <div class="panel-header">
      <strong>{{ xiaoqu.name }}</strong>
      <button class="close-btn" @click="handleClose">×</button>
    </div>
    <p class="score-text">综合评分：{{ xiaoqu.score }}</p>
    <div ref="chartRef" class="radar-chart"></div>
  </div>
</template>

<style scoped>
.radar-float-panel {
  position: absolute;
  left: calc(1.25 * var(--unit));
  width: calc(39 * var(--unit));
  z-index: 95;
  background: rgba(255, 255, 255, 0.98);
  border-radius: calc(1.25 * var(--unit));
  box-shadow: 0 calc(0.5 * var(--unit)) calc(2.25 * var(--unit)) rgba(0, 0, 0, 0.2);
  padding: calc(1.5 * var(--unit));
  display: flex;
  flex-direction: column;
  gap: var(--unit);
  clip-path: inset(0 0 0 0 round calc(1.25 * var(--unit)));
}
.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: var(--unit);
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
  height: calc(50 * var(--unit));
}
</style>
