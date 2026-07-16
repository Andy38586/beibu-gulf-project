<script setup>
import { ref, computed, inject, watch } from 'vue'
import { useRouter } from 'vue-router'
import { FACILITY_CONFIG } from '@/business/site-selection/composables/useFacilities'
import { useSiteAnalysisApi } from '@/business/site-selection/composables/useSiteAnalysisApi'
import { useAuth } from '@/shared/composables/useAuth'
import { usePlans } from '@/shared/composables/usePlans'
import PlanSaveModal from '@/shared/components/PlanSaveModal.vue'
import { useGCS } from '@/core/layout/useGCS.js'

const emit = defineEmits(['result-update', 'require-login'])
const router = useRouter()

const { cellPixel } = useGCS()
const unitPx = computed(() => cellPixel.value * 0.1)

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
  calcError.value = ''
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
  const matched = result.matchedXiaoqu ?? []
  matchedCount.value = matched.length
  emit('result-update', {
    coverage: result.coverage ?? null,
    matchedXiaoqu: matched,
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
const showLoginHint = ref(false)
const saveClickTime = ref(0)

async function handleSavePlan() {
  const now = Date.now()
  if (now - saveClickTime.value < 1000) {
    return
  }
  saveClickTime.value = now

  if (!isAuthenticated.value) {
    showLoginHint.value = true
    return
  }
  saveError.value = ''
  saveMessage.value = ''
  showSaveModal.value = true
}

function handleGoLogin() {
  router.push('/profile')
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
        <el-checkbox v-model="typeSettings[key].selected" class="type-label">
          <span :style="{ color: conf.color }">●</span>
          {{ conf.label }}
        </el-checkbox>
        <el-select
          v-if="typeSettings[key]?.selected"
          v-model.number="typeSettings[key].importance"
          size="small"
          class="importance-select"
        >
          <el-option v-for="n in 5" :key="n" :label="IMPORTANCE_LABELS[n]" :value="n" />
        </el-select>
      </div>
    </div>
    <div class="btn-group">
      <el-button size="small" :loading="calculating" @click="runAnalysis">
        {{ calculating ? '分析中...' : '开始筛选' }}
      </el-button>
      <el-button size="small" type="default" @click="clearAll">清空</el-button>
    </div>
    <div class="save-section">
      <el-button size="small" type="primary" @click="handleSavePlan">保存方案</el-button>
      <div v-if="showLoginHint" class="login-hint">
        <span class="hint-text">需要登录后才能使用保存方案</span>
        <span class="login-link" @click="handleGoLogin">点击这里登录</span>
      </div>
    </div>
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
  display: flex;
  flex-direction: column;
  gap: calc(1.25 * v-bind(unitPx));
}
.buffer-control h3 {
  margin: 0;
  font-size: calc(2 * v-bind(unitPx));
  color: #333;
}
.type-list {
  display: flex;
  flex-direction: column;
  gap: v-bind(unitPx);
}
.type-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: calc(1.75 * v-bind(unitPx));
}
.type-label {
  display: flex;
  align-items: center;
  gap: v-bind(unitPx);
}
.importance-select {
  width: calc(11.25 * v-bind(unitPx));
}
.btn-group {
  display: flex;
  gap: calc(0.75 * v-bind(unitPx));
}
.btn-group button {
  flex: 1;
}
.save-section {
  display: flex;
  flex-direction: column;
  gap: calc(0.5 * v-bind(unitPx));
}
.save-section button {
  width: 100%;
}
.login-hint {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: calc(0.5 * v-bind(unitPx));
}
.hint-text {
  font-size: calc(1.375 * v-bind(unitPx));
  color: #999;
}
.login-link {
  font-size: calc(1.375 * v-bind(unitPx));
  color: #409eff;
  cursor: pointer;
  text-decoration: none;
}
.login-link:hover {
  text-decoration: underline;
}
.error-text {
  color: #e74c3c;
  font-size: calc(1.625 * v-bind(unitPx));
  margin: 0;
}
.result-text {
  color: #27ae60;
  font-size: calc(1.75 * v-bind(unitPx));
  font-weight: 500;
  margin: 0;
}
.save-message {
  color: #27ae60;
  font-size: calc(1.625 * v-bind(unitPx));
  margin: 0;
}
</style>
