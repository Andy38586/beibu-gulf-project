<script setup>
import { ref, computed, inject, watch } from 'vue'
import { FACILITY_CONFIG } from '@/composables/useFacilities'
import { useSiteAnalysisApi } from '@/composables/useSiteAnalysisApi'
import { useAuth } from '@/composables/useAuth'
import { usePlans } from '@/composables/usePlans'
import PlanSaveModal from '@/components/user/PlanSaveModal.vue'

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
    calcError.value = '请至少选择一种设施类型?'
    return
  }
  const validTypes = Object.keys(FACILITY_CONFIG)
  const invalid = selectedKeys.value.filter((k) => !validTypes.includes(k))
  if (invalid.length) {
    calcError.value = `未知类型: ${invalid.join(',')}`
    return
  }
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

const restorePlanData = inject('restorePlanData', ref(null))
const editingPlan = inject('editingPlan', ref(null))

watch(
  restorePlanData,
  (settings) => {
    if (!settings || Object.keys(settings).length === 0) return
    Object.keys(FACILITY_CONFIG).forEach((key) => {
      typeSettings.value[key] = {
        selected: false,
        importance: 3,
        defaultRadius: FACILITY_CONFIG[key].defaultRadius,
      }
    })
    Object.entries(settings).forEach(([key, value]) => {
      if (typeSettings.value[key]) {
        typeSettings.value[key] = {
          ...typeSettings.value[key],
          selected: true,
          importance: value.importance,
        }
      } else {
        console.warn('[BufferControl] 未知设施类型:', key)
      }
    })
  },
  { deep: true },
)

const { isAuthenticated } = useAuth()
const { getPlans, createPlan, updatePlan, deletePlan } = usePlans()
const showSaveModal = ref(false)
const saveMessage = ref('')
const saveError = ref('')
const saving = ref(false)

async function handleSavePlan() {
  if (!isAuthenticated.value) {
    saveMessage.value = '请先登录'
    return
  }
  saveError.value = ''
  saveMessage.value = ''
  showSaveModal.value = true
}

async function onSavePlan(name) {
  saving.value = true
  try {
    if (editingPlan.value?.id) {
      await updatePlan(editingPlan.value.id, name, typeSettings.value)
      editingPlan.value = null
    } else {
      const plans = await getPlans()
      const dup = plans.find((p) => p.name === name.trim())
      if (dup) {
        const ok = window.confirm(
          '\u5df2\u5b58\u5728\u201c' + name.trim() + '\u201d\uff0c\u662f\u5426\u8986\u76d6\uff1f',
        )
        if (!ok) {
          saving.value = false
          return
        }
        await deletePlan(dup.id)
      }
      await createPlan(name.trim(), typeSettings.value)
    }
    showSaveModal.value = false
    saveMessage.value = '\u65b9\u6848\u4fdd\u5b58\u6210\u529f'
  } catch (e) {
    saveError.value = e.message || '\u4fdd\u5b58\u5931\u8d25'
  } finally {
    saving.value = false
  }
}
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
    <button v-if="isAuthenticated" @click="handleSavePlan">保存方案</button>
    <p v-if="saveMessage" class="save-message">{{ saveMessage }}</p>
    <p v-if="calcError" class="error-text">{{ calcError }}</p>
    <p v-if="matchedCount !== null" class="result-text">
      符合条件的小区（按推荐度排序，最多{{ TOP_N }}个）：{{ matchedCount }} 个
    </p>
  </div>
  <PlanSaveModal
    :visible="showSaveModal"
    :saving="saving"
    :error-msg="saveError"
    :initial-name="editingPlan?.name || ''"
    @close="showSaveModal = false"
    @save="onSavePlan"
  />
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
.save-message {
  color: #27ae60;
  font-size: 13px;
  margin: 0;
}
</style>
