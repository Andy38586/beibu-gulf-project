<!-- 预测分析控制面板（4×4）：上半为 4 个指标按钮（三态）+ 置信度滑块，
     下半为时间轴卡片（点击才展开滑块）+ 3 个可点击刻度 -->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'

import { useSliderFocus } from '@/core'
import {
  BASE_YEAR,
  CANAL_SCENARIO_OPTIONS,
  CONFIRM_DELAY,
  DEFAULT_CONFIDENCE,
  END_YEAR,
  ROW_HEIGHT_CELL,
  SliderSelectCard,
  useGCS,
} from '@/shared'
import { useForecastStore } from '@/stores'

import { useForecastOrchestrator } from '../composables/useForecastOrchestrator'
import { currentTimeToStep, stepToTime as timelineStepToTime } from '../timeline'

const forecastState = useForecastStore()

// 滑块专注模式（安卓控制中心风格）：拖动滑块时隐藏其他面板，只留本面板
const { beginSliderFocus, endSliderFocus } = useSliderFocus()

// GCS 尺寸变量：cell8px=0.1cell 面板内边距；cell16px=0.2cell 按钮间距
const { cellPixel, css } = useGCS()
const { cell8px, cell16px } = css
/** 按钮高度：固定行高，系数取自 panelGridCapacity 的 ROW_HEIGHT_CELL（与容量公式共用同一份比例） */
const btnHeightCss = computed(() => `${cellPixel.value * ROW_HEIGHT_CELL}px`)
/** 字体档位：0.175cell 标签、0.2cell 图标、0.15cell 小字、0.125cell 角标 */
const labelFontSizeCss = computed(() => `${cellPixel.value * 0.175}px`)
const iconFontSizeCss = computed(() => `${cellPixel.value * 0.2}px`)
const smallFontSizeCss = computed(() => `${cellPixel.value * 0.15}px`)
// CONFIRM_DELAY 两面板共用，统一放 shared/constants/ui

// ===== 三个指标 =====
// cargo/container 为官方真吞吐量热力；activity 为真数据派生「港口吞吐活跃度」指数
//（cargo 基期归一指数，见 tools/forecast/derive-activity.mjs）。berth/traffic 纯合成指标已下架
//（源文件保留标 _provenance），不再有「（模拟）」角标
const INDICATORS = [
  { key: 'cargo', label: '货物', icon: '📦' },
  { key: 'container', label: '集装箱', icon: '📋' },
  { key: 'activity', label: '港口吞吐活跃度', icon: '📈' },
]

// selected 由 store activeIndicator 派生（getter）——
// 快照恢复 restoreState 设置 activeIndicator 后按钮高亮自动一致（原本地双源：恢复非 cargo 时按钮仍亮 cargo）
const btnStates = reactive(
  Object.fromEntries(
    INDICATORS.map((i) => [
      i.key,
      {
        get selected() {
          return forecastState.activeIndicator === i.key
        },
        selecting: false,
      },
    ])
  )
)
const timers: Record<string, ReturnType<typeof setTimeout> | null> = {}

function toggleBtn(key: string) {
  const s = btnStates[key]
  if (!s.selected) {
    // 取消其他按钮的 selecting 计时器并复位（selected 已派生，无需直写）
    Object.keys(btnStates).forEach((k) => {
      btnStates[k].selecting = false
      clearTimer(k)
    })
    forecastState.setActiveIndicator(key)
    s.selecting = true
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
  const target = e.target as HTMLElement
  if (!target.closest('.forecast-ctrl')) confirmAll()
  // 时间轴卡片展开态点外部收起（卡片自身 click.stop，点卡片不会走到这里）
  if (!target.closest('.time-section')) timeCardOpen.value = false
}

function getConf(key: string) {
  return forecastState.confidenceThresholds[key] ?? DEFAULT_CONFIDENCE
}

// ===== 运河情景（F4）：仅 cargo 有文献锚点，其余指标禁用非基线档 =====
const scenarioDisabled = computed(() => forecastState.activeIndicator !== 'cargo')
function pickScenario(id: string) {
  if (scenarioDisabled.value) return
  if (forecastState.canalScenario !== id) forecastState.setCanalScenario(id)
}

// ===== v4-S3：请求归属上移——"用户改了什么"由本面板发起 =====
// 三路共享事务的编排器由页面 provide（AbortController 单实例），本面板 inject 后调用；
// 页面只保留"渲染器就绪"这一次渲染侧初始化触发（见 ForecastPage.vue）。
const { doForecastUpdate } = useForecastOrchestrator()

/** 距最后一次操作 300ms 统一刷新：合并 indicator/time/confidence/运河情景 的连续变化，避免双触发 */
const REFRESH_DEBOUNCE_MS = 300
let refreshTimer: ReturnType<typeof setTimeout> | null = null
watch(
  () => [
    forecastState.activeIndicator,
    forecastState.currentTime,
    forecastState.confidenceThresholds[forecastState.activeIndicator],
    forecastState.canalScenario,
  ],
  () => {
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => void doForecastUpdate(), REFRESH_DEBOUNCE_MS)
  }
)

onMounted(() => {
  document.addEventListener('click', handleGlobalClick)
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
  // v4-S3：卸载后不再发起请求（与页面的 cancelAll 互补：这边防的是"还没发出去"的那一次）
  if (refreshTimer) {
    clearTimeout(refreshTimer)
    refreshTimer = null
  }
})

// ===== 时间滑块 =====
/** 时间轴卡片展开态：默认收起（无 range），点击卡片进入选择态才渲染滑块；点时间区外回到已选态 */
const timeCardOpen = ref(false)

const isYearMode = computed({
  get: () => forecastState.timeGranularity === 'year',
  set: (v) => forecastState.setTimeGranularity(v ? 'year' : 'month'),
})

const maxSteps = computed(() =>
  // 月模式最大合法步 = (END_YEAR-BASE_YEAR)*12+11（=2031-12，stepToTime 闭合）；
  // 原 (END_YEAR-BASE_YEAR+1)*12=132 会越界到 2032-01
  isYearMode.value ? END_YEAR - BASE_YEAR : (END_YEAR - BASE_YEAR) * 12 + 11
)

// 步数换算收口 ../timeline（年/月双基共用一索引；年串切月 m 缺省兜 1，防 NaN——审查 H-3）
const currentStep = computed(() => currentTimeToStep(forecastState.currentTime, isYearMode.value))

function stepToTime(step: number) {
  return timelineStepToTime(step, isYearMode.value)
}

/** 时间轴滑块输入（SliderSelectCard 已抽出 number，无需重复解析事件对象） */
function onTimelineSliderInput(value: number) {
  forecastState.setCurrentTime(stepToTime(value))
}

/** 仅滑块本体进入专注模式：pointerdown 从 range 经卡片冒泡到时间区，卡片按钮点击不触发 */
function onTimePointerDown(e: PointerEvent) {
  const target = e.target as HTMLElement | null
  if (target?.matches?.('input[type="range"]')) beginSliderFocus(target)
}

/** 中位年份（起止年中点；刻度与步长共用同一取值） */
const MID_YEAR = Math.round((BASE_YEAR + END_YEAR) / 2)

const YEAR_MARKS = [
  { year: BASE_YEAR, step: 0, label: `${BASE_YEAR}.1` },
  {
    year: MID_YEAR,
    step: (MID_YEAR - BASE_YEAR) * 12,
    label: `${MID_YEAR}.1`,
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
    // !Number.isFinite 防御：currentTime 异常（坏快照/历史脏数据）时 currentStep 为 NaN，
    // NaN >= N 恒 false 曾穿透守卫死循环（H-3）——异常值直接停播而非永续推进
    if (
      !forecastState.isPlaying ||
      !Number.isFinite(currentStep.value) ||
      currentStep.value >= maxSteps.value
    ) {
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
    <div class="btn-grid" data-overflow-exit="scroll">
      <div
        v-for="ind in INDICATORS"
        :key="ind.key"
        :class="[
          'btn-cell',
          { sel: btnStates[ind.key].selected, ing: btnStates[ind.key].selecting },
        ]"
        @mousedown.stop
      >
        <!-- 三态选择卡片（公共组件 SliderSelectCard，与选址统一） -->
        <SliderSelectCard
          :selecting="btnStates[ind.key].selecting"
          :selected="btnStates[ind.key].selected"
          :label="ind.label"
          :status-text="`${(getConf(ind.key) * 100).toFixed(0)}%`"
          :slider-value="btnStates[ind.key].selecting ? getConf(ind.key) : null"
          :slider-min="0.8"
          :slider-max="1.2"
          :slider-step="0.05"
          @toggle="toggleBtn(ind.key)"
          @update:slider-value="(v) => onConfidenceSliderInput(ind.key, String(v))"
        >
          <template #icon>
            <span class="ind-icon">{{ ind.icon }}</span>
          </template>
        </SliderSelectCard>
      </div>
    </div>

    <!-- ===== 运河情景（仅 cargo 可选）===== -->
    <div class="scenario-row" :class="{ off: scenarioDisabled }">
      <span class="scenario-label">运河情景</span>
      <div class="scenario-chips">
        <button
          v-for="opt in CANAL_SCENARIO_OPTIONS"
          :key="opt.id"
          type="button"
          class="scenario-chip"
          :class="{ sel: forecastState.canalScenario === opt.id }"
          :disabled="scenarioDisabled && opt.id !== 'baseline'"
          @click="pickScenario(opt.id)"
        >
          {{ opt.label }}
        </button>
      </div>
    </div>

    <!-- ===== 下半：时间轴（滑块收进统一卡片，点击才展开；专注模式与刻度跳年保留） ===== -->
    <div class="time-section">
      <div class="time-grid">
        <div class="time-card">
          <!-- 三态选择卡片（公共组件 SliderSelectCard）：默认=按钮，点击进入选择态才渲染滑块 -->
          <SliderSelectCard
            :selecting="timeCardOpen"
            :selected="true"
            label="时间轴"
            :status-text="displayTime"
            :slider-value="timeCardOpen ? currentStep : null"
            :slider-min="0"
            :slider-max="maxSteps"
            :slider-step="1"
            @toggle="timeCardOpen = true"
            @update:slider-value="onTimelineSliderInput"
            @pointerdown="onTimePointerDown"
            @pointerup="endSliderFocus"
            @pointercancel="endSliderFocus"
          />
        </div>
        <label class="gr-toggle time-granularity">
          <input v-model="isYearMode" type="checkbox" />年
        </label>
        <div class="time-slider-wrap">
          <div class="t-ticks">
            <span
              v-for="(m, i) in YEAR_MARKS"
              :key="m.year"
              class="t-tick clickable"
              :class="{
                't-tick--start': i === 0,
                't-tick--end': i === YEAR_MARKS.length - 1 && yearMarkPosition(m.year) >= 100,
              }"
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

  /* 容量出口（c043）：容量按 panelGridCapacity 公式算，不钉常数；条目超出可见高时
     不被 GCSPanel 的 overflow:hidden 裁掉，可滚可达 */
  overflow-y: auto;
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

.ind-icon {
  font-size: v-bind(iconFontSizeCss);
  line-height: 1;
}

/* ===== 运河情景行 ===== */
.scenario-row {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: v-bind(cell8px);
}

.scenario-row.off .scenario-label {
  color: var(--GCS-text-muted);
}

.scenario-label {
  font-size: v-bind(smallFontSizeCss);
  color: var(--GCS-text-secondary);
  white-space: nowrap;
}

.scenario-chips {
  display: flex;
  gap: v-bind(cell8px);
  flex: 1;
  min-width: 0;
}

.scenario-chip {
  flex: 1;
  min-width: 0;
  padding: v-bind(cell8px) 0;
  background: var(--GCS-bg-container);
  border: 1px solid var(--GCS-border-default);
  border-radius: var(--GCS-radius-lg);
  font-size: v-bind(smallFontSizeCss);
  color: var(--GCS-text-regular);
  cursor: pointer;
}

.scenario-chip.sel {
  background: var(--GCS-bg-active);
  border-color: var(--GCS-color-primary);
  color: var(--GCS-color-primary);
  font-weight: 600;
}

.scenario-chip:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* ===== 时间轴（滑块收进统一卡片；控件行高 0.8cell，与卡片行高同源） ===== */
.time-section {
  flex-shrink: 0;
}

.time-grid {
  display: grid;
  grid-template-columns: 1fr auto auto;
  align-items: center;
  column-gap: v-bind(cell8px);
}

.time-card {
  grid-column: 1;
  grid-row: 1;
  height: v-bind(btnHeightCss);
}

.time-granularity {
  grid-column: 2;
  grid-row: 1;
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
  grid-column: 1;
  grid-row: 2;
  align-self: start;
  height: 18px;
}

.t-ticks {
  position: absolute;
  bottom: 0;

  /* 与卡片内滑块同宽：卡片 1px 边框 + 8px 内边距各占 9px，滑块 width:80% 的两侧留白用 margin 10% 复刻 */
  left: 9px;
  right: 9px;
  margin: 0 10%;
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

/* 首尾刻度收进面板：起点改左对齐、终点改右对齐（translateX(-50%) 会溢出面板被裁切） */
.t-tick--start {
  transform: none;
}

.t-tick--end {
  transform: translateX(-100%);
}

.time-acts {
  grid-column: 3;
  grid-row: 1;
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
  /* hover 底改通用 --GCS-bg-hover token（原用边框色充底）；
     面板内操作钮与地图悬浮 GCSButton 职责可区分，抽 FlatButton 留待按钮体系重构 */
  background: var(--GCS-bg-hover);
}

/* ing 态图标反色（其余视觉由 .btn-cell.ing 组合提供；选择卡片样式归 SliderSelectCard） */
.btn-cell.ing .ind-icon {
  color: var(--GCS-text-inverse);
}
</style>
