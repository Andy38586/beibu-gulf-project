<script setup lang="ts">
// 选址分析控制面板：2 列×4 行网格，6 个设施因子按钮 + 清空/分析。
// 按钮三态：默认（白）→ 选择（蓝 + 滑块，自动确认）→ 已选（白 + 重要程度标签）
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'

import { CONFIRM_DELAY, showWarning, useGCS } from '@/shared'
import type { AnalysisResult, FacilityType, TypeSetting } from '@/types/analysis'

import { FACILITY_CONFIG } from '../composables/facilityConfig'
import { useSiteAnalysisApi } from '../composables/useSiteAnalysisApi'

interface Emits {
  (_e: 'result-update', _result: Partial<AnalysisResult>): void
  (_e: 'analysis-error', _message: string): void
  (_e: 'analysis-empty', _reason: string): void
}

const emit = defineEmits<Emits>()

// GCS 尺寸变量：cell8px=0.1cell 面板内边距；cell16px=0.2cell 按钮间距
const { cellPixel, css } = useGCS()
const { cell8px, cell16px } = css
/** 按钮高度 0.8 cell（网格行高） */
const btnHeightCss = computed(() => `${cellPixel.value * 0.8}px`)
/** 字体档位：0.175cell 标签、0.2cell 圆点、0.125cell 重要程度 */
const labelFontSizeCss = computed(() => `${cellPixel.value * 0.175}px`)
const iconFontSizeCss = computed(() => `${cellPixel.value * 0.2}px`)
const levelFontSizeCss = computed(() => `${cellPixel.value * 0.125}px`)

/** 面板元素引用（用于外部点击检测） */
const panelRef = ref<HTMLElement | null>(null)

// CONFIRM_DELAY 两面板共用，统一放 shared/constants/ui

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
    .map(([k]) => k)
)

const { analyze, calculating, calcError, cancel } = useSiteAnalysisApi()

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
  // 防重复提交守卫
  if (calculating.value) {
    // 向用户展示可视化反馈
    showWarning('分析正在进行中，请稍候')
    return
  }

  calcError.value = ''
  // 先确认所有选择
  confirmAll()
  if (selectedKeys.value.length === 0) {
    showWarning('请至少选择一种设施类型')
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
    // 只通过 emit 传递，由页面级统一处理（避免重复弹窗）
    emit('analysis-error', calcError.value)
    return
  }
  // 8-1：无重叠区域 = 合法空结果（02 §4.1），emit 提示而非错误
  if (result.empty) {
    emit('analysis-empty', result.emptyReason || '所选设施类型覆盖范围无重叠区域')
    return
  }
  emit('result-update', {
    coverage: result.coverage ?? null,
    matchedXiaoqu: result.matchedXiaoqu ?? [],
    facilityPoi: result.facilityPoi ?? {},
    selectedTypes: selectedKeys.value,
  })
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
  }))
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
  // 卸载时取消在途选址分析请求，避免回调写入已卸载组件
  cancel()
  // 清理所有计时器
  Object.values(confirmTimers).forEach((timer) => {
    if (timer) clearTimeout(timer)
  })
})

function getSettings() {
  return JSON.parse(JSON.stringify(typeSettings))
}

function restoreSettings(settings: Record<string, unknown>) {
  if (!settings) return
  Object.entries(settings).forEach(([key, value]) => {
    const cfg = typeSettings[key]
    if (!cfg) return
    // C-9：外部快照数据 unknown 承接，字段级守卫（防 undefined.selected 隐式解引用）
    const v = value as { selected?: unknown; importance?: unknown } | null
    if (v && typeof v === 'object') {
      cfg.selected = Boolean(v.selected) || false
      cfg.importance = typeof v.importance === 'number' ? v.importance : 3
    }
    cfg.selecting = false
  })
}

defineExpose({
  getSettings,
  restoreSettings,
})
</script>

<template>
  <div ref="panelRef" class="factor-panel">
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
            v-model.number="item.setting.importance"
            type="range"
            class="factor-slider"
            min="1"
            max="5"
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
  </div>
</template>

<style scoped>
/* 面板内边距 0.1cell */
.factor-panel {
  width: 100%;
  height: 100%;
  padding: v-bind(cell8px);
  box-sizing: border-box;
}

/* 按钮网格：2 列 × 4 行，列 1.8fr、行 0.8cell、间距 0.2cell */
.factor-grid {
  display: grid;
  grid-template-columns: repeat(2, 1.8fr);
  grid-auto-rows: v-bind(btnHeightCss);
  gap: v-bind(cell16px);
  height: 100%;
  align-content: start;
}

.factor-item {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 0;
  width: 100%;
  height: 100%;
}

/* 默认态 / 已选态：白色按钮（尺寸与 LayerControlPanel 一致） */
.factor-btn {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: v-bind(cell8px);
  background: var(--GCS-bg-panel);
  border: 1px solid var(--GCS-border-default);
  border-radius: var(--GCS-radius-lg);
  cursor: pointer;
  font-size: v-bind(labelFontSizeCss);
  color: var(--GCS-text-regular);
  transition:
    background-color 0.2s ease,
    border-color 0.2s ease;
  padding: v-bind(cell8px) 4px;
  box-sizing: border-box;
}

.factor-btn:hover {
  border-color: var(--GCS-color-primary);
  background: var(--GCS-bg-hover);
}

.factor-dot {
  font-size: v-bind(iconFontSizeCss);
  line-height: 1;
}

.factor-label {
  font-weight: 500;
  line-height: 1.2;
}

/* 已选态：带重要程度标签（3 元素需紧凑间距） */
.factor-btn.confirmed {
  gap: 2px;
}

.factor-level {
  font-size: v-bind(levelFontSizeCss);
  color: var(--GCS-color-primary);
  line-height: 1;
}

/* 选择态：蓝色背景 + 滑块 */
.factor-item.selected.selecting {
  background: var(--GCS-color-primary);
  border-radius: var(--GCS-radius-lg);
}

.factor-slider-wrap {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: v-bind(cell8px);
  padding: v-bind(cell8px);
  box-sizing: border-box;
  cursor: default;
}

.factor-slider {
  width: 80%;
  height: var(--GCS-slider-track-height); /* 816-S7-44：轨道高统一 token（原 4px） */
  appearance: none;

  /* c052：轨道底色为 --GCS-overlay-tint 同语义变体（50% 略深，视觉与 conf-slider 区分） */
  background: rgb(255 255 255 / 50%);
  border-radius: calc(var(--GCS-slider-track-height) / 2);
  outline: none;
  cursor: pointer;
  margin: 0;
}

.factor-slider::-webkit-slider-thumb {
  appearance: none;
  /* 816-S7-44：拇指统一 --GCS-slider-thumb-size（原 14px 同值，显式引用） */
  width: var(--GCS-slider-thumb-size);
  height: var(--GCS-slider-thumb-size);
  border-radius: 50%;
  background: var(--GCS-bg-panel);
  cursor: pointer;
  border: none;
}

.factor-slider::-moz-range-thumb {
  width: var(--GCS-slider-thumb-size); /* 816-S7-44：统一 token */
  height: var(--GCS-slider-thumb-size);
  border-radius: 50%;
  background: var(--GCS-bg-panel);
  cursor: pointer;
  border: none;
}

.factor-importance {
  font-size: v-bind(levelFontSizeCss);
  color: var(
    --GCS-text-inverse
  ); /* 816-S7-62：bg-panel 语义为背景，前景一律 text-inverse（原数值恰等，非功能性改动） */
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  text-align: center;
}

/* 操作按钮样式 */
.action-btn.clear-btn {
  color: var(--GCS-text-regular);
}

.action-btn.clear-btn:hover {
  border-color: var(--GCS-color-primary);
  color: var(--GCS-color-primary);
}

.action-btn.analyze-btn {
  background: var(--GCS-color-primary);
  color: var(
    --GCS-text-inverse
  ); /* 816-S7-62：bg-panel 语义为背景，前景一律 text-inverse（原数值恰等，非功能性改动） */
  border-color: var(--GCS-color-primary);
}

.action-btn.analyze-btn:hover:not(:disabled) {
  background: var(--GCS-color-primary-hover);
  border-color: var(--GCS-color-primary-hover);
}

.action-btn.analyze-btn:disabled {
  /* 816-S7-47：禁用态走 text-disabled token（原裸 opacity 0.6） */
  color: var(--GCS-text-disabled);
  cursor: not-allowed;
}
</style>
