<!-- 预测分析控制面板（4×4）：上半为 4 个指标按钮（三态）+ 置信度滑块，
     下半为时间轴滑块 + 3 个可点击刻度（2018/2025/2035）；滑块是唯一交互入口 -->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive } from 'vue'

import { useSliderFocus } from '@/core/layout/useSliderFocus'
import { BASE_YEAR, CONFIRM_DELAY, DEFAULT_CONFIDENCE, END_YEAR, useGCS } from '@/shared'
import { useForecastStore } from '@/stores'

const forecastState = useForecastStore()

// 滑块专注模式（安卓控制中心风格）：拖动滑块时隐藏其他面板，只留本面板
const { beginSliderFocus, endSliderFocus } = useSliderFocus()

// GCS 尺寸变量：cell8px=0.1cell 面板内边距；cell16px=0.2cell 按钮间距
const { cellPixel, css } = useGCS()
const { cell8px, cell16px } = css
/** 按钮高度 0.8 cell（固定行高，不自动拉伸） */
const btnHeightCss = computed(() => `${cellPixel.value * 0.8}px`)
/** 字体档位：0.175cell 标签、0.2cell 图标、0.15cell 小字、0.125cell 角标 */
const labelFontSizeCss = computed(() => `${cellPixel.value * 0.175}px`)
const iconFontSizeCss = computed(() => `${cellPixel.value * 0.2}px`)
const smallFontSizeCss = computed(() => `${cellPixel.value * 0.15}px`)
const levelFontSizeCss = computed(() => `${cellPixel.value * 0.125}px`)
// CONFIRM_DELAY 两面板共用，统一放 shared/constants/ui

// ===== 四个指标 =====
// berth/traffic 为合成示意数据（后端数据文件标记 source: synthetic），UI 显示「（模拟）」角标；
// cargo 走吞吐量模型固定基线（后端不支持情景），不提供置信度滑块（单一事实源在后端）
const SYNTHETIC_INDICATORS = new Set(['berth', 'traffic'])
const MODEL_FIXED_INDICATORS = new Set(['cargo'])
const INDICATORS = [
  { key: 'cargo', label: '货物', icon: '📦' },
  { key: 'container', label: '集装箱', icon: '📋' },
  { key: 'berth', label: '泊位利用率', icon: '⚓' },
  { key: 'traffic', label: '船舶流量', icon: '🚢' },
].map((i) => ({ ...i, synthetic: SYNTHETIC_INDICATORS.has(i.key) }))

const btnStates = reactive(
  Object.fromEntries(INDICATORS.map((i) => [i.key, { selected: false, selecting: false }]))
)
const timers: Record<string, ReturnType<typeof setTimeout> | null> = {}

function toggleBtn(key: string) {
  const s = btnStates[key]
  if (!s.selected) {
    Object.keys(btnStates).forEach((k) => {
      btnStates[k].selected = k === key
      btnStates[k].selecting = k === key
      clearTimer(k)
    })
    forecastState.setActiveIndicator(key)
    resetTimer(key)
  } else if (s.selected && !s.selecting) {
    s.selecting = true
    resetTimer(key)
  }
}

function onSliderInput(key: string) {
  resetTimer(key)
}

// 置信度滑块防抖
let confidenceDebounceTimer: ReturnType<typeof setTimeout> | null = null
function onConfidenceSliderInput(key: string, value: string) {
  if (confidenceDebounceTimer) clearTimeout(confidenceDebounceTimer)
  confidenceDebounceTimer = setTimeout(() => {
    forecastState.setConfidenceThreshold(key, Number(value))
    onSliderInput(key)
  }, 300)
}
function confirmBtn(key: string) {
  if (btnStates[key].selecting) {
    btnStates[key].selecting = false
    clearTimer(key)
  }
}
function resetTimer(key: string) {
  clearTimer(key)
  timers[key] = setTimeout(() => confirmBtn(key), CONFIRM_DELAY)
}
function clearTimer(key: string) {
  if (timers[key]) {
    clearTimeout(timers[key])
    timers[key] = null
  }
}
function confirmAll() {
  Object.keys(btnStates).forEach((k) => {
    if (btnStates[k].selecting) confirmBtn(k)
  })
}
function handleGlobalClick(e: Event) {
  if (!(e.target as HTMLElement).closest('.forecast-ctrl')) confirmAll()
}

function getConf(key: string) {
  return forecastState.confidenceThresholds[key] ?? DEFAULT_CONFIDENCE
}

onMounted(() => {
  document.addEventListener('click', handleGlobalClick)
  btnStates.cargo.selected = true
})
onUnmounted(() => {
  document.removeEventListener('click', handleGlobalClick)
  Object.keys(timers).forEach(clearTimer)
  // 置信度滑块防抖定时器清理：卸载后不再写 store
  if (confidenceDebounceTimer) {
    clearTimeout(confidenceDebounceTimer)
    confidenceDebounceTimer = null
  }
  // 卸载时若滑块专注模式仍激活立即退出，避免残留下页面板全透明
  endSliderFocus()
})

// ===== 时间滑块 =====
const isYearMode = computed({
  get: () => forecastState.timeGranularity === 'year',
  set: (v) => forecastState.setTimeGranularity(v ? 'year' : 'month'),
})

const maxSteps = computed(() =>
  isYearMode.value ? END_YEAR - BASE_YEAR : (END_YEAR - BASE_YEAR + 1) * 12
)

const currentStep = computed(() => {
  const [y, m] = forecastState.currentTime.split('-').map(Number)
  return isYearMode.value ? y - BASE_YEAR : (y - BASE_YEAR) * 12 + (m - 1)
})

function stepToTime(step: number) {
  if (isYearMode.value) return String(BASE_YEAR + step)
  return `${BASE_YEAR + Math.floor(step / 12)}-${String((step % 12) + 1).padStart(2, '0')}`
}

function onSlider(e: Event) {
  forecastState.setCurrentTime(stepToTime(Number((e.target as HTMLInputElement).value)))
}

const YEAR_MARKS = [
  { year: BASE_YEAR, step: 0, label: `${BASE_YEAR}.1` },
  {
    year: Math.round((BASE_YEAR + END_YEAR) / 2),
    step: (Math.round((BASE_YEAR + END_YEAR) / 2) - BASE_YEAR) * 12,
    label: `${Math.round((BASE_YEAR + END_YEAR) / 2)}.1`,
  },
  { year: END_YEAR, step: (END_YEAR - BASE_YEAR) * 12, label: `${END_YEAR}.1` },
]

function yearMarkPosition(year: number) {
  if (isYearMode.value) return ((year - BASE_YEAR) / (END_YEAR - BASE_YEAR)) * 100
  return (((year - BASE_YEAR) * 12) / maxSteps.value) * 100
}

function jumpToYear(year: number) {
  forecastState.setCurrentTime(`${year}-01`)
}

const displayTime = computed(() => {
  const t = forecastState.currentTime
  return isYearMode.value ? t + '年' : t.replace('-', '年') + '月'
})

// ===== 播放 =====
let playbackTimer: ReturnType<typeof setInterval> | null = null
function togglePlay() {
  forecastState.setIsPlaying(!forecastState.isPlaying)
  if (forecastState.isPlaying) startPlayback()
  else stopPlayback()
}
function startPlayback() {
  playbackTimer = setInterval(() => {
    if (!forecastState.isPlaying || currentStep.value >= maxSteps.value) {
      forecastState.setIsPlaying(false)
      stopPlayback()
      return
    }
    forecastState.setCurrentTime(stepToTime(currentStep.value + 1))
  }, forecastState.playSpeed)
}
function stopPlayback() {
  if (playbackTimer) {
    clearInterval(playbackTimer)
    playbackTimer = null
  }
}
onUnmounted(() => stopPlayback())
</script>

<template>
  <div class="forecast-ctrl">
    <!-- ===== 上半：4 个指标按钮（2×2）===== -->
    <div class="btn-grid">
      <div
        v-for="ind in INDICATORS"
        :key="ind.key"
        :class="[
          'btn-cell',
          { sel: btnStates[ind.key].selected, ing: btnStates[ind.key].selecting },
        ]"
        @mousedown.stop
      >
        <template v-if="!btnStates[ind.key].selecting">
          <button
            :class="['ind-btn', { ok: btnStates[ind.key].selected }]"
            @click.stop="toggleBtn(ind.key)"
          >
            <span class="ind-icon">{{ ind.icon }}</span>
            <span class="ind-label">{{ ind.label }}</span>
            <span v-if="ind.synthetic" class="ind-synth">（模拟）</span>
            <span v-if="btnStates[ind.key].selected" class="ind-conf"
              >{{ (getConf(ind.key) * 100).toFixed(0) }}%</span
            >
          </button>
        </template>
        <div v-else class="slider-cell" @click.stop>
          <span class="ind-icon">{{ ind.icon }}</span>
          <span class="ind-label-s">{{ ind.label }}</span>
          <span v-if="ind.synthetic" class="ind-synth">（模拟）</span>
          <!-- cargo 走模型固定基线：不提供置信度滑块（可拖但无效果），显示基线标注 -->
          <span v-if="MODEL_FIXED_INDICATORS.has(ind.key)" class="conf-fixed">模型基线</span>
          <input
            v-else
            type="range"
            min="0.8"
            max="1.2"
            step="0.05"
            :value="getConf(ind.key)"
            class="conf-slider"
            @pointerdown="beginSliderFocus($event.currentTarget as HTMLInputElement)"
            @pointerup="endSliderFocus"
            @pointercancel="endSliderFocus"
            @input="onConfidenceSliderInput(ind.key, ($event.target as HTMLInputElement).value)"
          />
          <span class="conf-pct">{{ (getConf(ind.key) * 100).toFixed(0) }}%</span>
        </div>
      </div>
    </div>

    <!-- ===== 下半：时间滑块 ===== -->
    <div class="time-section">
      <div class="time-header">
        <span class="time-label">{{ displayTime }}</span>
        <label class="gr-toggle"><input v-model="isYearMode" type="checkbox" />年</label>
      </div>
      <div class="time-slider-wrap">
        <input
          type="range"
          :min="0"
          :max="maxSteps"
          :value="currentStep"
          class="t-slider"
          @pointerdown="beginSliderFocus($event.currentTarget as HTMLInputElement)"
          @pointerup="endSliderFocus"
          @pointercancel="endSliderFocus"
          @input="onSlider"
        />
        <div class="t-ticks">
          <span
            v-for="m in YEAR_MARKS"
            :key="m.year"
            class="t-tick clickable"
            :style="{ left: yearMarkPosition(m.year) + '%' }"
            @click="jumpToYear(m.year)"
            >{{ m.label }}</span
          >
        </div>
      </div>
      <div class="time-acts">
        <button class="act-btn" @click="togglePlay">
          {{ forecastState.isPlaying ? '⏸' : '▶' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 面板内边距 0.1cell（与 LayerControlPanel 一致）；段落间距 0.2cell */
.forecast-ctrl {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: v-bind(cell8px);
  box-sizing: border-box;
  gap: v-bind(cell16px);
}

/* 按钮网格：2 列 1.8fr，行高 0.8cell，间距 0.2cell */
.btn-grid {
  display: grid;
  grid-template-columns: repeat(2, 1.8fr);
  grid-auto-rows: v-bind(btnHeightCss);
  gap: v-bind(cell16px);
  flex: 1;
  min-height: 0;
}

.btn-cell {
  border-radius: var(--GCS-radius-lg);
  transition:
    background-color 0.2s,
    border-color 0.2s;
}

.btn-cell.sel {
  background: var(--GCS-bg-active);
  border: 1px solid var(--GCS-color-primary);
}

.btn-cell.ing {
  background: var(--GCS-color-primary);
  border: 1px solid var(--GCS-color-primary);
}

.ind-btn {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  border: 1px solid var(--GCS-border-default);
  border-radius: var(--GCS-radius-lg);
  background: var(--GCS-bg-panel);
  cursor: pointer;
  padding: v-bind(cell8px) 4px;
  box-sizing: border-box;
  color: var(--GCS-text-regular);
}

.ind-btn:hover {
  border-color: var(--GCS-color-primary);
  background: var(--GCS-bg-hover);
}

.ind-btn.ok {
  border-color: var(--GCS-color-primary);
}

.ind-icon {
  font-size: v-bind(iconFontSizeCss);
  line-height: 1;
}

.ind-label {
  font-size: v-bind(labelFontSizeCss);
  font-weight: 500;
}

.ind-synth {
  font-size: v-bind(levelFontSizeCss);
  color: var(--GCS-color-warning);
  margin-left: 2px;
}

.ind-conf {
  font-size: v-bind(levelFontSizeCss);
  color: var(--GCS-color-primary);
}

/* 置信度滑块（选择态：紧凑布局，4 元素需小间距） */
.slider-cell {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: v-bind(cell8px);
  box-sizing: border-box;
  cursor: default;
}

.slider-cell .ind-icon {
  font-size: v-bind(iconFontSizeCss);
}

.slider-cell .ind-label-s {
  font-size: v-bind(smallFontSizeCss);
  color: var(--GCS-bg-panel);
}

.conf-slider {
  width: 80%;
  height: 4px;
  appearance: none;
  background: rgb(255 255 255 / 40%);
  border-radius: 2px;
  outline: none;
  cursor: pointer;
}

.conf-slider::-webkit-slider-thumb {
  appearance: none;

  /* S7-19：与 t-slider 统一 16px 拇指（原 14px vs 18px 不一致） */
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--GCS-bg-panel);
  cursor: pointer;
  border: 2px solid var(--GCS-color-primary);
  box-shadow: var(--GCS-shadow-sm);
}

.conf-slider::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--GCS-bg-panel);
  cursor: pointer;
  border: 2px solid var(--GCS-color-primary);
}

.conf-pct {
  font-size: v-bind(levelFontSizeCss);
  color: var(--GCS-bg-panel);
  font-weight: 600;
}

/* 模型固定基线标注（cargo 无置信度滑块） */
.conf-fixed {
  font-size: v-bind(levelFontSizeCss);
  color: var(--GCS-text-muted);
  font-weight: 500;
  flex: 1;
  text-align: center;
}

/* ===== 时间滑块 ===== */
.time-section {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: v-bind(cell8px);
}

.time-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.time-label {
  font-size: v-bind(labelFontSizeCss);
  font-weight: 600;
  color: var(--GCS-color-primary);
}

.gr-toggle {
  display: flex;
  align-items: center;
  gap: v-bind(cell8px);
  font-size: v-bind(smallFontSizeCss);
  color: var(--GCS-text-secondary);
  cursor: pointer;
}

.gr-toggle input {
  cursor: pointer;
}

.time-slider-wrap {
  position: relative;
  padding-bottom: v-bind(cell16px);
}

.t-slider {
  width: 100%;
  height: 6px;
  appearance: none;
  background: linear-gradient(to right, var(--GCS-border-default), var(--GCS-color-primary));
  border-radius: 3px;
  outline: none;
  cursor: pointer;
}

.t-slider::-webkit-slider-thumb {
  appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--GCS-color-primary);
  cursor: pointer;
  border: 2px solid var(--GCS-bg-panel);
  box-shadow: var(--GCS-shadow-sm);
}

.t-slider::-moz-range-thumb {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--GCS-color-primary);
  cursor: pointer;
  border: 2px solid var(--GCS-bg-panel);
  box-shadow: var(--GCS-shadow-sm);
}

.t-ticks {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 18px;
}

.t-tick {
  position: absolute;
  transform: translateX(-50%);
  font-size: v-bind(smallFontSizeCss);
  color: var(--GCS-text-muted);
  white-space: nowrap;
}

.t-tick.clickable {
  color: var(--GCS-color-primary);
  font-weight: 500;
  cursor: pointer;
}

.t-tick.clickable:hover {
  color: var(--GCS-color-primary-hover);
  text-decoration: underline;
}

.time-acts {
  display: flex;
  justify-content: center;
}

.act-btn {
  padding: v-bind(cell8px) v-bind(cell16px);
  background: var(--GCS-bg-container);
  border: 1px solid var(--GCS-border-default);
  border-radius: var(--GCS-radius-lg);
  font-size: v-bind(labelFontSizeCss);
  cursor: pointer;
  color: var(--GCS-text-regular);
}

.act-btn:hover {
  background: var(--GCS-border-default);
}
</style>
