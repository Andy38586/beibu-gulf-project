<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import * as echarts from 'echarts'
import { FACILITY_LABELS } from '@/composables/facilityLabels'

const props = defineProps({
  matchedXiaoqu: { type: Array, default: () => [] },
  selectedTypes: { type: Array, default: () => [] },
})
const activeXiaoqu = ref(null)
const chartRef = ref(null)
let chartInstance = null

function selectXiaoqu(xq) {
  activeXiaoqu.value = xq
}
function closeDetail() {
  activeXiaoqu.value = null
}
function renderRadar() {
  if (!activeXiaoqu.value || !chartRef.value) return

  if (!chartInstance) {
    chartInstance = echarts.init(chartRef.value)
  }
  const indicators = props.selectedTypes.map((key) => ({
    name: FACILITY_LABELS[key] || key,
    max: 100,
  }))
  const values = props.selectedTypes.map((key) => activeXiaoqu.value.breakdown?.[key] ?? 0)
  chartInstance.setOption({
    tooltip: {},
    radar: {
      indicator: indicators,
      radius: '65%',
    },
    series: [
      {
        type: 'radar',
        data: [
          {
            value: values,
            name: activeXiaoqu.value.name,
            areaStyle: { opacity: 0.3 },
          },
        ],
      },
    ],
  })
}
watch([activeXiaoqu, () => props.selectedTypes], renderRadar, { flush: 'post' })
onBeforeUnmount(() => {
  chartInstance?.dispose()
})
const hasResult = computed(() => props.matchedXiaoqu.length > 0)
</script>

<template>
  <div v-if="hasResult" class="result-panel">
    <h4>推荐小区名单</h4>
    <ul class="xiaoqu-list">
      <li
        v-for="(xq, i) in matchedXiaoqu"
        :key="xq.id"
        class="xiaoqu-item"
        @click="selectXiaoqu(xq)"
      >
        <span class="rank">{{ i + 1 }}</span>
        <span class="name">{{ xq.name }}</span>
        <span class="score">{{ xq.score }}分</span>
      </li>
    </ul>

    <div v-if="activeXiaoqu" class="detail-overlay" @click.self="closeDetail">
      <div class="detail-card">
        <div class="detail-header">
          <strong>{{ activeXiaoqu.name }}</strong>
          <button class="close-btn" @click="closeDetail">×</button>
        </div>
        <p class="detail-score">综合评分：{{ activeXiaoqu.score }}</p>
        <div ref="chartRef" class="radar-chart"></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.result-panel {
  position: absolute;
  bottom: 10px;
  right: 10px;
  width: 300px;
  max-height: 320px;
  overflow-y: auto;
  background: white;
  padding: 12px;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  z-index: 30;
}
.xiaoqu-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.xiaoqu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 4px;
  font-size: 14px;
  cursor: pointer;
  border-radius: 4px;
}
.xiaoqu-item:hover {
  background: #f5f7fa;
}
.rank {
  width: 20px;
  color: #999;
  font-size: 12px;
}
.name {
  flex: 1;
}
.score {
  color: #409eff;
  font-weight: 500;
}

.detail-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.detail-card {
  background: white;
  border-radius: 10px;
  padding: 16px;
  width: 360px;
}
.detail-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.close-btn {
  background: none;
  border: none;
  font-size: 18px;
  cursor: pointer;
  color: #999;
}
.detail-score {
  color: #27ae60;
  font-weight: 500;
  margin: 0 0 8px;
}
.radar-chart {
  width: 100%;
  height: 280px;
}
</style>
