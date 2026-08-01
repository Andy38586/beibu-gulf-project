<script setup lang="ts">
/**
 * GCSPanel - GCS V2 Panel 容器
 *
 * 统一视觉语言：
 * - 位置和尺寸基于 anchor + offset + w + h 的 PPS 定位系统
 * - 圆角 = CELL_PIXEL × 0.15
 * - 白色实体背景 + 轻阴影
 *
 * V2 变更：
 * - 移除 x/y props（旧 Grid 坐标）
 * - 新增 anchor/offsetX/offsetY props（PPS 定位）
 * - 位置由 useGCS().panelPosition() 计算
 *
 * Props:
 * - w: 横向 Cell 数（必须）
 * - h: 纵向 Cell 数（必须）
 * - anchor: 锚点（默认 'top-left'）
 * - offsetX: 水平偏移（Cell 单位，默认 0）
 * - offsetY: 垂直偏移（Cell 单位，默认 0）
 */

import { computed } from 'vue'

import { useGCS } from '../useGCS.js'

interface Props {
  w: number
  h: number
  /** 锚点位置：用联合字面量类型约束，替代运行时 validator */
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

const { panelPosition } = useGCS()

/**
 * c016: 输出 CSS 变量而非直接内联定位属性。
 * 外部组件可通过 :deep(.GCS-panel) { --gcs-panel-left: ... } 覆盖，无需 !important。
 */
const panelStyle = computed(() => {
  const pos = panelPosition(props.w, props.h, props.anchor, props.offsetX, props.offsetY)
  const wPx = parseFloat(pos.width) || props.w * 80
  const hPx = parseFloat(pos.height) || props.h * 80
  return {
    '--gcs-panel-left': pos.left || '20px',
    '--gcs-panel-top': pos.top || '20px',
    '--gcs-panel-width': `${wPx}px`,
    '--gcs-panel-height': `${hPx}px`,
    '--gcs-panel-min-width': `${props.w * 80}px`,
    '--gcs-panel-min-height': `${props.h * 80}px`,
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
  /* c016: 定位属性消费 CSS 变量，外部可通过 :deep 覆盖变量而非 !important */
  position: absolute;
  left: var(--gcs-panel-left, 20px);
  top: var(--gcs-panel-top, 20px);
  width: var(--gcs-panel-width, 320px);
  height: var(--gcs-panel-height, 240px);
  min-width: var(--gcs-panel-min-width, 80px);
  min-height: var(--gcs-panel-min-height, 80px);
  border-radius: var(--GCS-radius-md);
  background-color: var(--GCS-bg-panel);
  box-shadow: var(--GCS-shadow-sm);
  box-sizing: border-box;
  overflow: hidden;
  pointer-events: auto;
  color: var(--GCS-text-regular);
}
</style>
