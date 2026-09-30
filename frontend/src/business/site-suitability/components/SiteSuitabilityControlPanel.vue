<!--
  新选址适宜性控制面板（单元五）：五准则权重滑块 + 陆地占比过滤。
  滑块拖动写 store（store 内归一化保证和=1），页面防抖后统一刷新。
-->
<script setup lang="ts">
import { computed } from 'vue'

import { useSliderFocus } from '@/core'
import { useGCS } from '@/shared'
import { useSiteSuitabilityStore } from '@/stores'

const state = useSiteSuitabilityStore()
const { beginSliderFocus, endSliderFocus } = useSliderFocus()
const { cellPixel, css } = useGCS()
const { cell8px } = css
const labelFontSizeCss = computed(() => `${cellPixel.value * 0.175}px`)
const smallFontSizeCss = computed(() => `${cellPixel.value * 0.15}px`)

const CRITERIA: Array<{
  key: 'inundation' | 'terrain' | 'land' | 'access' | 'demand'
  label: string
}> = [
  { key: 'inundation', label: '浸没安全' },
  { key: 'terrain', label: '地形施工' },
  { key: 'land', label: '土地适宜' },
  { key: 'access', label: '交通可达' },
  { key: 'demand', label: '产业需求' },
]

function pct(key: keyof typeof state.weights): string {
  return `${Math.round(state.weights[key] * 100)}%`
}

const LAND_FRAC_STEPS = [0.3, 0.5, 0.7]
</script>

<template>
  <div class="ss-ctrl">
    <div class="sec-title">准则权重（自动归一化）</div>
    <div v-for="c in CRITERIA" :key="c.key" class="w-row">
      <span class="w-label">{{ c.label }}</span>
      <input
        type="range"
        min="0"
        max="1"
        step="0.05"
        :value="state.weights[c.key]"
        class="w-slider"
        @pointerdown="beginSliderFocus($event.currentTarget as HTMLInputElement)"
        @pointerup="endSliderFocus"
        @pointercancel="endSliderFocus"
        @input="state.setWeight(c.key, Number(($event.target as HTMLInputElement).value))"
      />
      <span class="w-value">{{ pct(c.key) }}</span>
    </div>
    <div class="sec-title">陆地占比下限</div>
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

.w-row {
  display: flex;
  align-items: center;
  gap: v-bind(cell8px);
}

.w-label {
  width: 4.5em;
  font-size: v-bind(smallFontSizeCss);
  color: var(--GCS-text-regular);
  white-space: nowrap;
}

.w-slider {
  flex: 1;
  height: var(--GCS-slider-thumb-size);
  appearance: none;
  background: linear-gradient(to right, var(--GCS-border-default), var(--GCS-color-primary));
  border-radius: calc(var(--GCS-slider-thumb-size) / 2);
  outline: none;
  cursor: pointer;
}

.w-slider::-webkit-slider-thumb {
  appearance: none;
  width: var(--GCS-slider-thumb-size);
  height: var(--GCS-slider-thumb-size);
  border-radius: 50%;
  background: var(--GCS-color-primary);
  cursor: pointer;
  border: 2px solid var(--GCS-bg-panel);
  box-shadow: var(--GCS-shadow-sm);
}

.w-slider::-moz-range-thumb {
  width: var(--GCS-slider-thumb-size);
  height: var(--GCS-slider-thumb-size);
  border-radius: 50%;
  background: var(--GCS-color-primary);
  cursor: pointer;
  border: 2px solid var(--GCS-bg-panel);
  box-shadow: var(--GCS-shadow-sm);
}

.w-value {
  width: 3em;
  text-align: right;
  font-size: v-bind(smallFontSizeCss);
  color: var(--GCS-text-secondary);
}

.frac-row {
  display: flex;
  gap: v-bind(cell8px);
}

.frac-btn {
  flex: 1;
  padding: v-bind(cell8px) 0;
  background: var(--GCS-bg-container);
  border: 1px solid var(--GCS-border-default);
  border-radius: var(--GCS-radius-lg);
  font-size: v-bind(smallFontSizeCss);
  color: var(--GCS-text-regular);
  cursor: pointer;
}

.frac-btn.sel {
  background: var(--GCS-bg-active);
  border-color: var(--GCS-color-primary);
  color: var(--GCS-color-primary);
  font-weight: 600;
}
</style>
