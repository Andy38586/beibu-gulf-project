<script setup>
/**
 * GcsButton - 按钮 Panel
 *
 * 统一视觉规则：
 * - 默认占 2×1 Panel
 * - 文字优先显示，图标位于文字下方（如果提供）
 * - 尺寸基于 CELL_PIXEL / PANEL_PIXEL 计算
 * - Frosted Glass 风格，带 hover 反馈
 *
 * Props:
 * - label: 按钮文字
 * - icon: 图标字符/类名（可选）
 * - disabled: 是否禁用
 * - active: 是否处于激活/选中态（用于图层开关等）
 * - w: 横向 Panel 数（默认 2）
 * - h: 纵向 Panel 数（默认 1）
 */

import { computed } from 'vue'
import { useGCS } from '../useGCS.js'

const props = defineProps({
  label: { type: String, default: '' },
  icon: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  active: { type: Boolean, default: false },
  w: { type: Number, default: 2 },
  h: { type: Number, default: 1 },
})

const emit = defineEmits(['click'])

const { panel, cellPixel } = useGCS()

const buttonStyle = computed(() => ({
  ...panel(props.w, props.h),
  borderRadius: `${cellPixel.value * 0.15}px`,
  backdropFilter: `blur(${cellPixel.value * 0.15}px)`,
  WebkitBackdropFilter: `blur(${cellPixel.value * 0.15}px)`,
  backgroundColor: props.active
    ? 'rgba(64, 158, 255, 0.35)'
    : 'rgba(255, 255, 255, 0.12)',
  boxShadow: '0 4px 16px rgba(0, 0, 0, 0.12)',
  fontSize: `${cellPixel.value * 0.18}px`,
}))

function handleClick() {
  if (!props.disabled) {
    emit('click')
  }
}
</script>

<template>
  <button
    type="button"
    class="gcs-button"
    :style="buttonStyle"
    :disabled="disabled"
    @click="handleClick"
  >
    <span class="button-label">{{ label }}</span>
    <span v-if="icon" class="button-icon" aria-hidden="true">{{ icon }}</span>
  </button>
</template>

<style scoped>
.gcs-button {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border: none;
  outline: none;
  cursor: pointer;
  color: #fff;
  transition: background-color 0.2s ease, transform 0.1s ease;
}

.gcs-button:hover:not(:disabled) {
  background-color: rgba(255, 255, 255, 0.22);
}

.gcs-button:active:not(:disabled) {
  transform: scale(0.98);
}

.gcs-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.button-label {
  font-weight: 500;
  line-height: 1.2;
}

.button-icon {
  margin-top: 4px;
  font-size: 0.85em;
  opacity: 0.9;
}
</style>
