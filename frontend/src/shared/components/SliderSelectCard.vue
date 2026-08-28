<script setup lang="ts">
/**
 * SliderSelectCard — 「点击弹出滑块」选择卡片（公共组件）。
 * 三态：默认（白底 label）/ 选择中（蓝底 + 滑块）/ 已选（白底 + 状态文案）。
 * 状态机由调用方持有：组件受控渲染，点击 emit('toggle')、滑块 emit('update:sliderValue')。
 * 差异全部参数化：色点/文字图标用 #icon 插槽，档位范围用 slider props，
 * 状态文案（重要度/置信度百分比/模型基线占位）用 statusText 或 sliderPlaceholder。
 */

interface Props {
  selecting: boolean
  selected: boolean
  label: string
  /** 色点颜色（选址因子）；与 #icon 插槽二选一 */
  dotColor?: string
  /** confirmed 态状态文案（如「一般重要」「85%」） */
  statusText?: string
  /** selecting 态滑块当前值（null = 不渲染滑块，显示占位文案） */
  sliderValue?: number | null
  sliderMin?: number
  sliderMax?: number
  sliderStep?: number
  /** selecting 态无滑块时的占位文案（如「模型基线」） */
  sliderPlaceholder?: string
  /** label 后附加小标（如「（模拟）」） */
  badge?: string
}

withDefaults(defineProps<Props>(), {
  dotColor: '',
  statusText: '',
  sliderValue: null,
  sliderMin: 1,
  sliderMax: 5,
  sliderStep: 1,
  sliderPlaceholder: '',
  badge: '',
})

const emit = defineEmits<{
  toggle: []
  'update:sliderValue': [value: number]
}>()

const onSliderInput = (e: Event) => {
  emit('update:sliderValue', Number((e.target as HTMLInputElement).value))
}
</script>

<template>
  <!-- 选择态：蓝底 + 滑块（三行：文字/滑块/状态；图标隐藏不占位） -->
  <div v-if="selecting" class="ssc selecting" @mousedown.stop @click.stop>
    <span class="ssc-label">{{ label }}</span>
    <span v-if="badge" class="ssc-badge">{{ badge }}</span>
    <input
      v-if="sliderValue !== null"
      type="range"
      class="ssc-slider"
      :min="sliderMin"
      :max="sliderMax"
      :step="sliderStep"
      :value="sliderValue"
      @input="onSliderInput"
    />
    <span v-else class="ssc-placeholder">{{ sliderPlaceholder }}</span>
    <span v-if="statusText" class="ssc-status">{{ statusText }}</span>
  </div>

  <!-- 已选态：白底 + 状态文案 -->
  <button v-else-if="selected" type="button" class="ssc confirmed" @click.stop="emit('toggle')">
    <span v-if="!$slots.icon && dotColor" class="ssc-dot" :style="{ color: dotColor }">●</span>
    <slot name="icon" />
    <span class="ssc-label">{{ label }}</span>
    <span v-if="badge" class="ssc-badge">{{ badge }}</span>
    <span v-if="statusText" class="ssc-status">{{ statusText }}</span>
  </button>

  <!-- 默认态：白底 + 名称 -->
  <button v-else type="button" class="ssc" @click.stop="emit('toggle')">
    <span v-if="!$slots.icon && dotColor" class="ssc-dot" :style="{ color: dotColor }">●</span>
    <slot name="icon" />
    <span class="ssc-label">{{ label }}</span>
    <span v-if="badge" class="ssc-badge">{{ badge }}</span>
  </button>
</template>

<style scoped>
.ssc {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px; /* 行距收紧：三层内容压进固定行高 */
  padding: 2px 8px; /* 上下收窄，状态文案留完整空间 */
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  border: 1px solid var(--GCS-border-default);
  border-radius: var(--GCS-radius-lg);
  background: var(--GCS-bg-panel);
  color: var(--GCS-text-regular);
  cursor: pointer;
  font-size: 14px;
  letter-spacing: -0.5px;
  line-height: 1.2;
  text-align: center;
}

.ssc:hover {
  border-color: var(--GCS-color-primary);
  background: var(--GCS-bg-hover);
}

.ssc.confirmed .ssc-label {
  color: var(--GCS-text-regular);
}

/* 选择态：蓝底反白 */
.ssc.selecting {
  background: var(--GCS-color-primary);
  border-color: var(--GCS-color-primary);
  cursor: default;
}

.ssc.selecting .ssc-label,
.ssc.selecting .ssc-badge,
.ssc.selecting .ssc-status,
.ssc.selecting .ssc-placeholder {
  color: var(--GCS-text-inverse);
}

.ssc-dot {
  font-size: 12px;
  line-height: 1;
}

.ssc-badge {
  font-size: 10px;
  line-height: 1;
  opacity: 0.85;
}

.ssc-status {
  font-size: 12px;
  line-height: 1;
  color: var(--GCS-color-primary);
  white-space: nowrap;
}

/* 滑块：迁移预测时间滑块的渐变轨道（灰→品牌色）+ primary 实心拇指白圈描边（蓝底上可辨）+ 投影 */
.ssc-slider {
  appearance: none;
  width: 80%;
  height: var(--GCS-slider-thumb-size);
  background: linear-gradient(to right, var(--GCS-border-default), var(--GCS-color-primary));
  border-radius: calc(var(--GCS-slider-thumb-size) / 2);
  outline: none;
  cursor: pointer;
  margin: 0;
}

.ssc-slider::-webkit-slider-thumb {
  appearance: none;
  width: var(--GCS-slider-thumb-size);
  height: var(--GCS-slider-thumb-size);
  border-radius: 50%;
  background: var(--GCS-color-primary);
  border: 2px solid white;
  box-shadow: 0 1px 3px rgb(0 0 0 / 35%); /* 投影让拇指从轨道上浮起，双主题可辨 */
  cursor: pointer;
}

.ssc-slider::-moz-range-thumb {
  width: var(--GCS-slider-thumb-size);
  height: var(--GCS-slider-thumb-size);
  border-radius: 50%;
  background: var(--GCS-color-primary);
  border: 2px solid white;
  box-shadow: 0 1px 3px rgb(0 0 0 / 35%);
  cursor: pointer;
}

.ssc-placeholder {
  font-size: 12px;
  line-height: 1;
  white-space: nowrap;
  opacity: 0.85;
}
</style>
