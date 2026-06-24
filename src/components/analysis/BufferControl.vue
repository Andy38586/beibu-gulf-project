<script setup>
import { ref, computed } from 'vue'
import { useFacilities } from '@/composables/useFacilities'
import { DEFAULT_WEIGHTS } from '@/composables/useScoring'
import { IMPORTANCE_LABELS } from '@/composables/importanceMapping'
import { runSiteAnalysis } from '@/composables/useSiteAnalysis'

const emit = defineEmits(['result-update'])

const { facilityData, xiaoquData, loading, loadError, loadAll, FACILITY_CONFIG } = useFacilities()

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
    typeSettings.value[key] = { selected: false, importance: 3, defaultRadius: conf.defaultRadius }
  })
}
init()
function runAnalysis() {
  calcError.value = ''
  matchedCount.value = null
  calculating.value = true
  try {
    const result = runSiteAnalysis({
      selectedKeys: selectedKeys.value,
      typeSettings: typeSettings.value,
      facilityData: facilityData.value,
      xiaoquData: xiaoquData.value,
      weights: weights.value,
    })

    if (result.error) {
      calcError.value = result.error
      emit('result-update', { coverage: null, matchedXiaoqu: [] })
      return
    }

    matchedCount.value = result.matchedXiaoqu.length
    emit('result-update', {
      coverage: result.coverage,
      matchedXiaoqu: result.matchedXiaoqu,
      selectedTypes: selectedKeys.value,
    })
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

defineExpose({
  clearAll,
  runAnalysis,
  selectedKeys,
})
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
    </template>
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
