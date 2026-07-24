<script setup lang="ts">
// 选址分析控制面板：4×4 Panel，2列×4行网格，6个设施因子按钮 + 清空/分析
// 按钮三态：默认(白) → 选择(蓝,滑块,3s自动确认) → 已选(白+重要程度标签)
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import { FACILITY_CONFIG } from '../composables/facilityConfig'
import { useSiteAnalysisApi } from '../composables/useSiteAnalysisApi'
import type { AnalysisResult, TypeSetting, FacilityType } from '@/types/analysis'
import ErrorPopup from '@/shared/components/ErrorPopup.vue'

interface Emits {
  (_e: 'result-update', _result: Partial<AnalysisResult>): void
  (_e: 'analysis-error', _message: string): void
}

const emit = defineEmits<Emits>()

/** 面板元素引用（用于外部点击检测） */
const panelRef = ref<HTMLElement | null>(null)

/** 自动确认延迟（毫秒） */
const CONFIRM_DELAY = 3000

/** 扩展 TypeSetting，添加 selecting 状态 */
interface LocalTypeSetting extends TypeSetting {
  selecting: boolean
}

/** 使用 reactive 确保所有属性响应式 */
const typeSettings = reactive<Record<string, LocalTypeSetting>>({})
Object.entries(FACILITY_CONFIG).forEach(([key]) => {
  typeSettings[key] = { selected: false, importance: 3, selecting: false, defaultRadius: 0 }
})

/** 计时器存储（不需要响应式） */
const confirmTimers: Record<string, ReturnType<typeof setTimeout> | null> = {}

/** 已选中的设施 key 列表 */
const selectedKeys = computed<string[]>(() =>
  Object.entries(typeSettings)
    .filter(([, v]) => v.selected)
    .map(([k]) => k),
)

const { analyze, calculating, calcError } = useSiteAnalysisApi()

/** 弹窗状态 */
const showPopup = ref<boolean>(false)
const popupMessage = ref<string>('')

/** 清除指定因子的计时器 */
function clearTimer(key: string): void {
  if (confirmTimers[key]) {
    clearTimeout(confirmTimers[key]!)
    confirmTimers[key] = null
  }
}

/** 启动指定因子的自动确认计时器 */
function startConfirmTimer(key: string): void {
  clearTimer(key)
  confirmTimers[key] = setTimeout(() => {
    if (typeSettings[key]) {
      typeSettings[key].selecting = false
    }
    confirmTimers[key] = null
  }, CONFIRM_DELAY)
}

/** 重置指定因子的计时器（用户操作滑块时调用） */
function resetConfirmTimer(key: string): void {
  if (typeSettings[key]?.selecting) {
    startConfirmTimer(key)
  }
}

/** 切换设施选择状态 */
function toggleFactor(key: string): void {
  const setting = typeSettings[key]
  if (!setting) return

  if (setting.selected && !setting.selecting) {
    // 已选态 → 重新进入选择态
    setting.selecting = true
    startConfirmTimer(key)
  } else if (!setting.selected) {
    // 默认态 → 进入选择态
    setting.selected = true
    setting.selecting = true
    startConfirmTimer(key)
  }
  // selecting 状态下点击不做处理，避免干扰滑块操作
}

/** 确认所有选择（点击外部区域时触发） */
function confirmAll(): void {
  Object.entries(typeSettings).forEach(([key, v]) => {
    v.selecting = false
    clearTimer(key)
  })
}

/** 清空所有选择 */
function clearAll(): void {
  Object.entries(typeSettings).forEach(([key, v]) => {
    v.selected = false
    v.selecting = false
    clearTimer(key)
  })
  emit('result-update', { coverage: null, matchedXiaoqu: [], facilityPoi: {}, selectedTypes: [] })
}

/** 开始分析 */
async function runAnalysis(): Promise<void> {
  // FIX:105: 防重复提交守卫
  if (calculating.value) {
    // P2-003-FIX: 向用户展示可视化反馈
    popupMessage.value = '分析正在进行中，请稍候'
    showPopup.value = true
    return
  }

  calcError.value = ''
  // 先确认所有选择
  confirmAll()
  if (selectedKeys.value.length === 0) {
    popupMessage.value = '请至少选择一种设施类型'
    showPopup.value = true
    return
  }
  // 构造后端期望的 typeSettings 格式
  const apiTypeSettings: Record<string, TypeSetting> = {}
  selectedKeys.value.forEach((key) => {
    const config = FACILITY_CONFIG[key as FacilityType]
    apiTypeSettings[key] = {
      defaultRadius: config.defaultRadius,
      importance: typeSettings[key].importance,
      selected: true,
    }
  })
  const result = await analyze({
    selectedKeys: selectedKeys.value as FacilityType[],
    typeSettings: apiTypeSettings,
  })
  if (calcError.value) {
    popupMessage.value = calcError.value || '网络异常，请重试'
    showPopup.value = true
    // FIX:P3-03: 向页面级错误弹窗传递错误
    emit('analysis-error', calcError.value)
    return
  }
  emit('result-update', {
    coverage: result.coverage ?? null,
    matchedXiaoqu: result.matchedXiaoqu ?? [],
    facilityPoi: result.facilityPoi ?? {},
    selectedTypes: selectedKeys.value,
  })
}

/** 重试分析 */
async function handleRetry(): Promise<void> {
  showPopup.value = false
  popupMessage.value = ''
  await runAnalysis()
}

/** 关闭弹窗 */
function handleClosePopup(): void {
  showPopup.value = false
  popupMessage.value = ''
  calcError.value = ''
}

/** 重要性标签 */
const IMPORTANCE_LABELS: Record<number, string> = {
  1: '不太在意',
  2: '稍微在意',
  3: '一般重要',
  4: '比较重要',
  5: '非常重要',
}

/** 设施列表（转为数组供 v-for 使用） */
const facilityList = computed(() =>
  Object.entries(FACILITY_CONFIG).map(([key, conf]) => ({
    key,
    ...conf,
    setting: typeSettings[key],
  })),
)

/** 点击外部区域立即结束所有选择态 */
function handleGlobalClick(e: MouseEvent): void {
  if (panelRef.value && !panelRef.value.contains(e.target as Node)) {
    confirmAll()
  }
}

onMounted(() => {
  document.addEventListener('click', handleGlobalClick)
})

onUnmounted(() => {
  document.removeEventListener('click', handleGlobalClick)
  // 清理所有计时器
  Object.values(confirmTimers).forEach((timer) => {
    if (timer) clearTimeout(timer)
  })
})

function getSettings() {
  return JSON.parse(JSON.stringify(typeSettings))
}

function restoreSettings(settings: Record<string, any>) {
  if (!settings) return
  Object.entries(settings).forEach(([key, value]) => {
    if (typeSettings[key]) {
      typeSettings[key].selected = value.selected || false
      typeSettings[key].importance = value.importance || 3
      typeSettings[key].selecting = false
    }
  })
}

defineExpose({
  getSettings,
  restoreSettings,
})
</script>

<template>
  <div class="factor-panel" ref="panelRef">
    <!-- 8 个按钮，2 列 × 4 行 -->
    <div class="factor-grid">
      <!-- 6 个设施因子按钮 -->
      <div
        v-for="item in facilityList"
        :key="item.key"
        class="factor-item"
        :class="{ selected: item.setting.selected, selecting: item.setting.selecting }"
      >
        <!-- 默认态：白色按钮，仅显示设施名称 -->
        <button
          v-if="!item.setting.selected"
          class="factor-btn"
          @click.stop="toggleFactor(item.key)"
        >
          <span class="factor-dot" :style="{ color: item.color }">●</span>
          <span class="factor-label">{{ item.label }}</span>
        </button>

        <!-- 选择态：蓝色背景 + 滑块 -->
        <div
          v-else-if="item.setting.selecting"
          class="factor-slider-wrap"
          @mousedown.stop
          @click.stop
        >
          <span class="factor-dot" :style="{ color: item.color }">●</span>
          <input
            type="range"
            class="factor-slider"
            min="1"
            max="5"
            v-model.number="item.setting.importance"
            @input="resetConfirmTimer(item.key)"
            @mousedown.stop
            @click.stop
          />
          <span class="factor-importance">{{ IMPORTANCE_LABELS[item.setting.importance] }}</span>
        </div>

        <!-- 已选态：白色按钮，显示名称 + 重要程度 -->
        <button v-else class="factor-btn confirmed" @click.stop="toggleFactor(item.key)">
          <span class="factor-dot" :style="{ color: item.color }">●</span>
          <span class="factor-label">{{ item.label }}</span>
          <span class="factor-level">{{ IMPORTANCE_LABELS[item.setting.importance] }}</span>
        </button>
      </div>

      <!-- 第 4 行：清空选择 + 开始分析 -->
      <button class="factor-btn action-btn clear-btn" @click.stop="clearAll">
        <span class="factor-label">清空选择</span>
      </button>
      <button
        class="factor-btn action-btn analyze-btn"
        :disabled="calculating"
        @click.stop="runAnalysis"
      >
        <span class="factor-label">{{ calculating ? '分析中...' : '开始分析' }}</span>
      </button>
    </div>

    <!-- 错误/提示弹窗 -->
    <ErrorPopup
      :visible="showPopup"
      :message="popupMessage"
      @close="handleClosePopup"
      @retry="handleRetry"
    />
  </div>
</template>

<style scoped>
.factor-panel {
  width: 100%;
  height: 100%;
  padding: 10px;
  box-sizing: border-box;
}

/* 按钮网格：2 列 × 4 行（与图层控制面板一致） */
.factor-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: repeat(4, 1fr);
  gap: 10px;
  height: 100%;
}

.factor-item {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 0;
  width: 100%;
  height: 100%;
}

/* 默认态 / 已选态：白色按钮 */
.factor-btn {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  background: #ffffff;
  border: 1px solid #e0e0e0;
  border-radius: 12px;
  cursor: pointer;
  font-size: 13px;
  color: #333;
  transition: all 0.2s ease;
  padding: 6px 4px;
  box-sizing: border-box;
}

.factor-btn:hover {
  border-color: #409eff;
  background: #f0f7ff;
}

.factor-dot {
  font-size: 12px;
  line-height: 1;
}

.factor-label {
  font-weight: 500;
  line-height: 1.2;
}

/* 已选态：带重要程度标签 */
.factor-btn.confirmed {
  gap: 2px;
}

.factor-level {
  font-size: 10px;
  color: #409eff;
  line-height: 1;
}

/* 选择态：蓝色背景 + 滑块 */
.factor-item.selected.selecting {
  background: #409eff;
  border-radius: 12px;
}

.factor-slider-wrap {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 6px 8px;
  box-sizing: border-box;
  cursor: default;
}

.factor-slider {
  width: 80%;
  height: 4px;
  -webkit-appearance: none;
  appearance: none;
  background: rgba(255, 255, 255, 0.5);
  border-radius: 2px;
  outline: none;
  cursor: pointer;
  margin: 0;
}

.factor-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
  cursor: pointer;
  border: none;
}

.factor-slider::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
  cursor: pointer;
  border: none;
}

.factor-importance {
  font-size: 10px;
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  text-align: center;
}

/* 操作按钮样式 */
.action-btn.clear-btn {
  color: #333;
}

.action-btn.clear-btn:hover {
  border-color: #409eff;
  color: #409eff;
}

.action-btn.analyze-btn {
  background: #409eff;
  color: #fff;
  border-color: #409eff;
}

.action-btn.analyze-btn:hover:not(:disabled) {
  background: #66b1ff;
  border-color: #66b1ff;
}

.action-btn.analyze-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
