<script setup lang="ts">
/**
 * GCSButton - 按钮 Panel
 * 默认 2×1 Cell，文字在上、图标在下，尺寸基于 Cell（80px 网格单元）计算；
 * 白色实体背景 + hover 反馈。Props：label/icon/disabled/active/w/h。
 */

import { computed } from 'vue'

import { useGCS } from '@/shared'

interface Props {
  label?: string
  icon?: string
  disabled?: boolean
  active?: boolean
  w?: number
  h?: number
}
const props = withDefaults(defineProps<Props>(), {
  label: '',
  icon: '',
  disabled: false,
  active: false,
  w: 2,
  h: 1,
})

const emit = defineEmits<{ click: [] }>()

const { cell, cellPixel } = useGCS()

const buttonStyle = computed(() => ({
  ...cell(props.w, props.h),
  borderRadius: `${cellPixel.value * 0.15}px`,
  backgroundColor: props.active ? 'var(--GCS-color-primary)' : 'var(--GCS-bg-panel)',
  color: props.active ? 'var(--GCS-text-inverse)' : 'var(--GCS-text-regular)',
  boxShadow: 'var(--GCS-shadow-sm)',
  fontSize: `${cellPixel.value * 0.18}px`,
}))

const iconStyle = computed(() => ({
  marginTop: `${cellPixel.value * 0.05}px`,
  fontSize: '0.85em',
  opacity: 0.9,
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
    class="GCS-button"
    :style="buttonStyle"
    :disabled="disabled"
    @click="handleClick"
  >
    <span class="button-label">{{ label }}</span>
    <span v-if="icon" class="button-icon" :style="iconStyle" aria-hidden="true">{{ icon }}</span>
  </button>
</template>

<style scoped>
.GCS-button {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border: none;
  outline: none;
  cursor: pointer;
  color: var(
    --GCS-text-inverse
  ); /* 816-S7-62：bg-panel 语义为背景，前景一律 text-inverse（原数值恰等，非功能性改动） */

  transition:
    background-color 0.2s ease,
    transform 0.1s ease;
}

/* 816-S7-43：outline:none 去掉默认环后用 :focus-visible 补可见焦点环（键盘可达性，WCAG 2.4.7） */
.GCS-button:focus-visible {
  outline: 2px solid var(--GCS-border-focus);
  outline-offset: 2px;
}

.GCS-button:hover:not(:disabled) {
  /* hover 高光较 overlay-tint 更淡（仅高光用），双主题 token 化随暗色降亮度 */
  background-color: var(--GCS-overlay-highlight);
}

.GCS-button:active:not(:disabled) {
  transform: scale(0.98);
}

.GCS-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.button-label {
  font-weight: 500;
  line-height: 1.2;
  letter-spacing: -0.5px; /* 字距收紧（全站通用按钮） */
}

.button-icon {
  font-size: 0.85em;
  opacity: 0.9;
}
</style>
