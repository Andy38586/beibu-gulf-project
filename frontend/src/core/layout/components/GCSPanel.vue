<script setup lang="ts">
/**
 * GCSPanel - GCS（网格化布局系统）Panel 容器
 * 位置与尺寸由 anchor + offset + w/h 经 PPS（面板定位系统）计算，
 * 统一视觉：圆角 = Cell × 0.15、白色实体背景 + 轻阴影。
 * Props：w/h 为 Cell（80px 网格单元）数（必填），anchor 锚点（默认 top-left），offsetX/Y 偏移（Cell 单位）。
 */

import { computed } from 'vue'

import { useGCS } from '@/shared'

interface Props {
  w: number
  h: number
  /** 锚点位置（联合字面量类型约束） */
  anchor?:
    | 'top-left'
    | 'top-right'
    | 'top-center'
    | 'bottom-center'
    | 'bottom-left'
    | 'bottom-right'
  offsetX?: number
  offsetY?: number
}

const props = withDefaults(defineProps<Props>(), {
  anchor: 'top-left',
  offsetX: 0,
  offsetY: 0,
})

const { panelPosition, cellPixel } = useGCS()

/**
 * 输出 CSS 变量而非内联定位属性，外部可用 :deep(.GCS-panel) 覆盖变量、无需 !important。
 * GCS 铁律：CSS 变量一律全大写 --GCS-* 前缀。
 * min-width/height 用响应式 cellPixel：窄屏面板等比缩小，避免实际宽度大于定位宽度而溢出。
 */
const panelStyle = computed(() => {
  const pos = panelPosition(props.w, props.h, props.anchor, props.offsetX, props.offsetY)
  const wPx = parseFloat(pos.width) || props.w * 80
  const hPx = parseFloat(pos.height) || props.h * 80
  const cell = cellPixel.value > 0 ? cellPixel.value : 80
  return {
    '--GCS-panel-left': pos.left || '20px',
    '--GCS-panel-top': pos.top || '20px',
    '--GCS-panel-width': `${wPx}px`,
    '--GCS-panel-height': `${hPx}px`,
    '--GCS-panel-min-width': `${props.w * cell}px`,
    '--GCS-panel-min-height': `${props.h * cell}px`,
  }
})
</script>

<template>
  <div class="GCS-panel" :style="panelStyle">
    <slot />
  </div>
</template>

<style scoped>
.GCS-panel {
  /* 定位属性消费 CSS 变量：外部可通过 :deep 覆盖而非 !important */
  position: absolute;
  left: var(--GCS-panel-left, 20px);
  top: var(--GCS-panel-top, 20px);
  width: var(--GCS-panel-width, 320px);
  height: var(--GCS-panel-height, 240px);
  min-width: var(--GCS-panel-min-width, 80px);
  min-height: var(--GCS-panel-min-height, 80px);
  border-radius: var(--GCS-radius-md);
  background-color: var(--GCS-bg-panel);
  box-shadow: var(--GCS-shadow-sm);
  box-sizing: border-box;
  overflow: hidden;
  pointer-events: auto;
  color: var(--GCS-text-regular);
}
</style>
