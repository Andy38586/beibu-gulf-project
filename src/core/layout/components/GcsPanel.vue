<script setup>
/**
 * GcsPanel - 通用 Panel 容器
 *
 * 统一视觉语言：
 * - 尺寸基于 CELL_PIXEL / PANEL_PIXEL 计算
 * - 圆角 = CELL_PIXEL × 0.15
 * - Frosted Glass = backdrop-filter: blur(CELL_PIXEL × 0.15)
 * - 背景半透明 + 统一阴影
 *
 * Props:
 * - w: 横向 Panel 数
 * - h: 纵向 Panel 数
 */

import { computed } from 'vue'
import { useGCS } from '../useGCS.js'

const props = defineProps({
  w: { type: Number, default: 1 },
  h: { type: Number, default: 1 },
})

const { panel, cellPixel } = useGCS()

const panelStyle = computed(() => ({
  ...panel(props.w, props.h),
  borderRadius: `${cellPixel.value * 0.15}px`,
  backdropFilter: `blur(${cellPixel.value * 0.15}px)`,
  WebkitBackdropFilter: `blur(${cellPixel.value * 0.15}px)`,
  backgroundColor: 'rgba(255, 255, 255, 0.12)',
  boxShadow: '0 4px 16px rgba(0, 0, 0, 0.12)',
}))
</script>

<template>
  <div class="gcs-panel" :style="panelStyle">
    <slot />
  </div>
</template>

<style scoped>
.gcs-panel {
  box-sizing: border-box;
  overflow: hidden;
  color: #fff;
}
</style>
