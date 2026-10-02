<!--
  新选址分析控制面板（单元五）：五准则权重卡片 + 陆地占比下限。
  滑块统一收进公共组件 SliderSelectCard（与老选址/预测面板同款三态卡片）：
  默认态=按钮，点击进入选择态才渲染滑块，点面板外部回到已选态（状态文案=当前权重）。
  权重拖动写 store（store 内归一化保证和=1），页面防抖后统一刷新。
-->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import { useSliderFocus } from '@/core'
import { ROW_HEIGHT_CELL, SliderSelectCard, useGCS } from '@/shared'
import { useSiteSuitabilityStore } from '@/stores'

import { CRITERIA } from '../constants/criteria'

const state = useSiteSuitabilityStore()
const { beginSliderFocus, endSliderFocus } = useSliderFocus()
const { cellPixel, css } = useGCS()
const { cell8px } = css
const labelFontSizeCss = computed(() => `${cellPixel.value * 0.175}px`)
const smallFontSizeCss = computed(() => `${cellPixel.value * 0.15}px`)
/** 卡片行高系数与 panelGridCapacity 的 ROW_HEIGHT_CELL 同源（三处控制面板统一 0.8cell） */
const cardHeightCss = computed(() => `${cellPixel.value * ROW_HEIGHT_CELL}px`)

const panelRef = ref<HTMLElement | null>(null)
/** 展开中的准则卡片（单手风琴：同时最多一张卡片处于选择态） */
const selectingKey = ref<string | null>(null)

// 准则清单已提到 ../constants/criteria.ts（雷达图面板共用同一份轴序与文案）

const LAND_FRAC_STEPS = [0.3, 0.5, 0.7]

function pct(key: keyof typeof state.weights): string {
  return `${Math.round(state.weights[key] * 100)}%`
}

/** 权重写入（归一化由 store.setWeight 保证；滑块组件已抽出 number，不再重复解析事件对象） */
function onWeightInput(key: keyof typeof state.weights, value: number): void {
  state.setWeight(key, value)
}

/** 仅滑块本体进入专注模式：pointerdown 从 range 冒泡到网格，卡片按钮点击不触发 */
function onSliderPointerDown(e: PointerEvent): void {
  const target = e.target as HTMLElement | null
  if (target?.matches?.('input[type="range"]')) beginSliderFocus(target)
}

/** 点面板外部回到已选态（复刻老选址「点外部确认」；卡片自身 click.stop 不会走到这里） */
function handleGlobalClick(e: MouseEvent): void {
  if (panelRef.value && !panelRef.value.contains(e.target as Node)) selectingKey.value = null
}

onMounted(() => {
  document.addEventListener('click', handleGlobalClick)
})

onUnmounted(() => {
  document.removeEventListener('click', handleGlobalClick)
})
</script>

<template>
  <div ref="panelRef" class="ss-ctrl">
    <div class="sec-title">准则权重（自动归一化）</div>
    <!-- 2 列 × 3 行：5 张准则卡片 + 陆地占比（末格）；行高与老选址控制面板同为 0.8cell -->
    <div
      class="criteria-grid"
      data-overflow-exit="scroll"
      @pointerdown="onSliderPointerDown"
      @pointerup="endSliderFocus"
      @pointercancel="endSliderFocus"
    >
      <div v-for="c in CRITERIA" :key="c.key" class="criteria-cell">
        <!-- 三态选择卡片（公共组件 SliderSelectCard）：默认/选择中滑块/已选 -->
        <SliderSelectCard
          :selecting="selectingKey === c.key"
          :selected="true"
          :label="c.label"
          :status-text="pct(c.key)"
          :slider-value="selectingKey === c.key ? state.weights[c.key] : null"
          :slider-min="0"
          :slider-max="1"
          :slider-step="0.05"
          @toggle="selectingKey = c.key"
          @update:slider-value="(value) => onWeightInput(c.key, value)"
        />
      </div>

      <!-- 末格：陆地占比下限（非滑块；填满网格末槽，避免空槽） -->
      <div class="criteria-cell land-cell">
        <span class="land-label">陆地占比下限</span>
        <div class="frac-row">
          <button
            v-for="s in LAND_FRAC_STEPS"
            :key="s"
            type="button"
            class="frac-btn"
            :class="{ sel: Math.abs(state.minLandFrac - s) < 1e-9 }"
            @click="state.setMinLandFrac(s)"
          >
            ≥{{ Math.round(s * 100) }}%
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ss-ctrl {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: v-bind(cell8px);
  box-sizing: border-box;
  gap: v-bind(cell8px);
  overflow-y: auto;
}

.sec-title {
  font-size: v-bind(labelFontSizeCss);
  font-weight: 600;
  color: var(--GCS-color-primary);
}

.criteria-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  grid-auto-rows: v-bind(cardHeightCss);
  gap: v-bind(cell8px);
  overflow-y: auto;
}

.criteria-cell {
  min-width: 0;
}

.land-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: v-bind(cell8px);
}

.land-label {
  font-size: v-bind(smallFontSizeCss);
  color: var(--GCS-text-secondary);
  white-space: nowrap;
}

.frac-row {
  display: flex;
  width: 100%;
  gap: v-bind(cell8px);
}

.frac-btn {
  flex: 1;
  min-width: 0;
  padding: v-bind(cell8px) 0;
  background: var(--GCS-bg-container);
  border: 1px solid var(--GCS-border-default);
  border-radius: var(--GCS-radius-lg);
  font-size: v-bind(smallFontSizeCss);
  color: var(--GCS-text-regular);
  white-space: nowrap;
  cursor: pointer;
}

.frac-btn.sel {
  background: var(--GCS-bg-active);
  border-color: var(--GCS-color-primary);
  color: var(--GCS-color-primary);
  font-weight: 600;
}
</style>
