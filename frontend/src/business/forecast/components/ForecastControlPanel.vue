<!-- ForecastControlPanel.vue
     预测分析控制面板（4×4 合并版）
     上半：4 个指标按钮（2×2），三态（默认/选择/已确认），置信度滑块
     下半：时间轴滑块 + 3 个可点击刻度（2018 / 2025 / 2035）
     滑块是唯一交互入口，直接驱动数据刷新 -->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive } from 'vue'

import { useForecastState } from '@/stores/forecastState'

import { BASE_YEAR, DEFAULT_CONFIDENCE, END_YEAR } from '../constants'

const forecastState = useForecastState()
const CONFIRM_DELAY = 3000

// ===== 四个指标 =====
const INDICATORS = [
  { key: 'cargo', label: '货物', icon: '📦' },
  { key: 'container', label: '集装箱', icon: '📋' },
  { key: 'berth', label: '泊位利用率', icon: '⚓' },
  { key: 'traffic', label: '船舶流量', icon: '🚢' },
]

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

// P2-03: 置信度滑块防抖
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
  forecastState.isPlaying = !forecastState.isPlaying
  if (forecastState.isPlaying) startPlayback()
  else stopPlayback()
}
function startPlayback() {
  playbackTimer = setInterval(() => {
    if (!forecastState.isPlaying || currentStep.value >= maxSteps.value) {
      forecastState.isPlaying = false
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
            <span v-if="btnStates[ind.key].selected" class="ind-conf"
              >{{ (getConf(ind.key) * 100).toFixed(0) }}%</span
            >
          </button>
        </template>
        <div v-else class="slider-cell" @click.stop>
          <span class="ind-icon">{{ ind.icon }}</span>
          <span class="ind-label-s">{{ ind.label }}</span>
          <input
            type="range"
            min="0.8"
            max="1.2"
            step="0.05"
            :value="getConf(ind.key)"
            class="conf-slider"
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
.forecast-ctrl {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 10px;
  box-sizing: border-box;
  gap: 10px;
}

/* ===== 按钮网格 ===== */
.btn-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  gap: 8px;
  flex: 1;
  min-height: 0;
}
.btn-cell {
  border-radius: 12px;
  transition: all 0.2s;
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
  gap: 3px;
  border: 1px solid var(--GCS-border-default);
  border-radius: 12px;
  background: var(--GCS-bg-panel);
  cursor: pointer;
  padding: 6px 4px;
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
  font-size: 18px;
  line-height: 1;
}
.ind-label {
  font-size: 13px;
  font-weight: 500;
}
.ind-conf {
  font-size: 10px;
  color: var(--GCS-color-primary);
}

/* 置信度滑块 */
.slider-cell {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 4px 8px;
  box-sizing: border-box;
  cursor: default;
}
.slider-cell .ind-icon {
  font-size: 16px;
}
.slider-cell .ind-label-s {
  font-size: 11px;
  color: var(--GCS-bg-panel);
}
.conf-slider {
  width: 80%;
  height: 4px;
  -webkit-appearance: none;
  appearance: none;
  background: rgba(255, 255, 255, 0.4);
  border-radius: 2px;
  outline: none;
  cursor: pointer;
}
.conf-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--GCS-bg-panel);
  cursor: pointer;
}
.conf-slider::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--GCS-bg-panel);
  cursor: pointer;
  border: none;
}
.conf-pct {
  font-size: 10px;
  color: var(--GCS-bg-panel);
  font-weight: 600;
}

/* ===== 时间滑块 ===== */
.time-section {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.time-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.time-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--GCS-color-primary);
}
.gr-toggle {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 12px;
  color: var(--GCS-text-secondary);
  cursor: pointer;
}
.gr-toggle input {
  cursor: pointer;
}

.time-slider-wrap {
  position: relative;
  padding-bottom: 20px;
}
.t-slider {
  width: 100%;
  height: 6px;
  -webkit-appearance: none;
  appearance: none;
  background: linear-gradient(to right, var(--GCS-border-default), var(--GCS-color-primary));
  border-radius: 3px;
  outline: none;
  cursor: pointer;
}
.t-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--GCS-color-primary);
  cursor: pointer;
  border: 2px solid var(--GCS-bg-panel);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
}
.t-slider::-moz-range-thumb {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--GCS-color-primary);
  cursor: pointer;
  border: 2px solid var(--GCS-bg-panel);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
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
  font-size: 11px;
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
  padding: 4px 14px;
  background: var(--GCS-bg-container);
  border: 1px solid var(--GCS-border-default);
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
  color: var(--GCS-text-regular);
}
.act-btn:hover {
  background: var(--GCS-border-default);
}
</style>
