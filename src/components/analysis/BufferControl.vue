<script setup>
import { ref, computed } from 'vue'
import * as turf from '@turf/turf'
import { useFacilities } from '@/composables/useFacilities'
import { scoreXiaoqu, DEFAULT_WEIGHTS } from '@/composables/useScoring'
import { linearDecay } from '@/composables/decayFunctions'

const emit = defineEmits(['result-update'])

const { facilityData, xiaoquData, loading, loadError, loadAll, FACILITY_CONFIG } = useFacilities()

const MAX_RADIUS = 100
const TOP_N = 10
const typeSettings = ref({})
const weights = ref({ ...DEFAULT_WEIGHTS })
const calculating = ref(false)
const calcError = ref('')
const matchedCount = ref(null)

const selectedKeys = computed(() =>
  Object.entries(typeSettings.value)
    .filter(([, v]) => v.selected)
    .map(([k]) => k),
)
async function init() {
  await loadAll()
  Object.entries(FACILITY_CONFIG).forEach(([key, conf]) => {
    typeSettings.value[key] = { selected: false, radius: conf.defaultRadius }
  })
}
init()
function buildCoverage(points, radiusKm) {
  const buffers = points.map((p) =>
    turf.buffer(turf.point([p.lng, p.lat]), radiusKm, { units: 'kilometers' }),
  )
  if (buffers.length === 1) return buffers[0]
  return turf.union(turf.featureCollection(buffers))
}
function runAnalysis() {
  calcError.value = ''
  matchedCount.value = null
  if (selectedKeys.value.length === 0) {
    calcError.value = '请至少选择一种设施类型'
    return
  }
  const invalidRadius = selectedKeys.value.find((key) => {
    const r = typeSettings.value[key].radius
    return !r || r <= 0 || r > MAX_RADIUS
  })
  if (invalidRadius) {
    calcError.value = `${FACILITY_CONFIG[invalidRadius].label}的半径需在 0~${MAX_RADIUS}公里 之间`
    return
  }
  calculating.value = true
  try {
    const coverages = selectedKeys.value.map((key) =>
      buildCoverage(facilityData.value[key] || [], typeSettings.value[key].radius),
    )
    let finalArea = coverages[0]
    for (let i = 1; i < coverages.length; i++) {
      finalArea = turf.intersect(turf.featureCollection([finalArea, coverages[i]]))
      if (!finalArea) break
    }
    if (!finalArea) {
      calcError.value = '所选设施的覆盖范围没有重叠区域，没有符合条件的小区'
      emit('result-update', { coverage: null, matchedXiaoqu: [] })
      return
    }
    const matched = xiaoquData.value.filter((xq) =>
      turf.booleanPointInPolygon(turf.point([xq.lng, xq.lat]), finalArea),
    )
    const scored = scoreXiaoqu(
      matched,
      facilityData.value,
      typeSettings.value,
      weights.value,
      linearDecay,
    )
    const top = scored.sort((a, b) => b.score - a.score).slice(0, TOP_N)
    matchedCount.value = top.length

    emit('result-update', { coverage: finalArea, matchedXiaoqu: top })
  } catch (error) {
    console.error('选址分析失败:', error)
    calcError.value = '分析失败，请稍后重试'
  } finally {
    calculating.value = false
  }
}
function clearAll() {
  Object.values(typeSettings.value).forEach((v) => (v.selected = false))
  matchedCount.value = null
  calcError.value = ''
  emit('result-update', { coverage: null, matchedXiaoqu: [] })
}
</script>

<template>
  <div class="buffer-control">
    <h3>选址分析</h3>
    <div v-if="loading">设施数据加载中...</div>
    <p v-else-if="loadError" class="error-text">{{ loadError }}</p>

    <template v-else>
      <div class="type-list">
        <div v-for="(conf, key) in FACILITY_CONFIG" :key="key" class="type-item">
          <label class="type-label">
            <input type="checkbox" v-model="typeSettings[key].selected" />
            <span :style="{ color: conf.color }">●</span>
            {{ conf.label }}
          </label>
          <input
            v-if="typeSettings[key]?.selected"
            type="number"
            v-model.number="typeSettings[key].radius"
            min="0.1"
            :max="MAX_RADIUS"
            step="0.1"
            class="inline-radius"
            title="该类型缓冲半径(公里)"
          />
        </div>
      </div>
      <button @click="runAnalysis" :disabled="calculating">
        {{ calculating ? '分析中...' : '开始筛选' }}
      </button>
      <button @click="clearAll">清空</button>
      <p v-if="calcError" class="error-text">{{ calcError }}</p>
      <p v-if="matchedCount !== null" class="result-text">
        符合条件的小区（按推荐度排序，最多{{ TOP_N }}个）：{{ matchedCount }} 个
      </p>
    </template>
  </div>
</template>

<style scoped>
.buffer-control {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 280px;
  background: white;
  padding: 12px;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  z-index: 30;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.type-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.type-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 14px;
}
.type-label {
  display: flex;
  align-items: center;
  gap: 6px;
}
.inline-radius {
  width: 60px;
}
.error-text {
  color: #e74c3c;
  font-size: 13px;
  margin: 0;
}
.result-text {
  color: #27ae60;
  font-size: 14px;
  font-weight: 500;
  margin: 0;
}
</style>
