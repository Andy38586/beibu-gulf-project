<script setup>
import { ref, computed } from 'vue'
import { FACILITY_CONFIG } from '@/composables/useFacilities'
import { useSiteAnalysisApi } from '@/composables/useSiteAnalysisApi'

const emit = defineEmits(['result-update'])

const TOP_N = 10
const IMPORTANCE_LABELS = {
  1: '不太在意',
  2: '稍微在意',
  3: '一般重要',
  4: '比较重要',
  5: '非常重要',
}
const typeSettings = ref({})
const matchedCount = ref(null)

Object.entries(FACILITY_CONFIG).forEach(([key, conf]) => {
  typeSettings.value[key] = { selected: false, importance: 3, defaultRadius: conf.defaultRadius }
})
const selectedKeys = computed(() =>
  Object.entries(typeSettings.value)
    .filter(([, v]) => v.selected)
    .map(([k]) => k),
)
const { analyze, calculating, calcError } = useSiteAnalysisApi()

async function runAnalysis() {
  matchedCount.value = null

  if (selectedKeys.value.length === 0) {
    calcError.value = '请至少选择一种设施类型'
    return
  }
  const validTypes = Object.keys(FACILITY_CONFIG)
  const invalid = selectedKeys.value.filter(k => !validTypes.includes(k))
  if (invalid.length) { calcError.value = `未知类型: ${invalid.join(',')}`; return }
  const result = await analyze({
    selectedKeys: selectedKeys.value,
    typeSettings: typeSettings.value,
  })
  if (calcError.value) {
    emit('result-update', { coverage: null, matchedXiaoqu: [] })
    return
  }
  matchedCount.value = result.matchedXiaoqu.length
  emit('result-update', {
    coverage: result.coverage,
    matchedXiaoqu: result.matchedXiaoqu,
    selectedTypes: selectedKeys.value,
  })
}
function clearAll() {
  Object.values(typeSettings.value).forEach((v) => (v.selected = false))
  matchedCount.value = null
  calcError.value = ''
  emit('result-update', { coverage: null, matchedXiaoqu: [] })
}
defineExpose({ clearAll, runAnalysis, selectedKeys })
</script>

<template>
  <div class="buffer-control">
    <h3>选址分析</h3>
    <div class="type-list">
      <div v-for="(conf, key) in FACILITY_CONFIG" :key="key" class="type-item">
        <label class="type-label">
          <input type="checkbox" v-model="typeSettings[key].selected" />
          <span :style="{ color: conf.color }">●</span>
          {{ conf.label }}
        </label>
        <select
          v-if="typeSettings[key]?.selected"
          v-model.number="typeSettings[key].importance"
          class="importance-select"
        >
          <option v-for="n in 5" :key="n" :value="n">{{ IMPORTANCE_LABELS[n] }}</option>
        </select>
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
  </div>
</template>

<style scoped>
.buffer-control {
  width: 100%;
  background: white;
  padding: 12px;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
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
.importance-select {
  font-size: 13px;
  width: 90px;
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
