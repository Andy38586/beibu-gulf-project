<script setup>
/**
 * GcsPanel - GCS V2 Panel 容器
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

const props = defineProps({
  w: { type: Number, required: true },
  h: { type: Number, required: true },
  anchor: {
    type: String,
    default: 'top-left',
    validator: (v) =>
      [
        'top-left',
        'top-right',
        'top-center',
        'bottom-center',
        'bottom-left',
        'bottom-right',
      ].includes(v),
  },
  offsetX: { type: Number, default: 0 },
  offsetY: { type: Number, default: 0 },
})

const { cellPixel, panelPosition } = useGCS()

/**
 * 计算 Panel 的 CSS 样式
 * 通过 panelPosition 函数获取位置和尺寸
 */
const panelStyle = computed(() => {
  const pos = panelPosition(props.w, props.h, props.anchor, props.offsetX, props.offsetY)
  // 最后一层防御：如果计算出的宽高为 0，用 cell 单位 × 默认 80px 兜底
  const wPx = parseFloat(pos.width) || (props.w * 80)
  const hPx = parseFloat(pos.height) || (props.h * 80)
  return {
    position: 'absolute',
    left: pos.left || '20px',
    top: pos.top || '20px',
    width: `${wPx}px`,
    height: `${hPx}px`,
    minWidth: `${props.w * 80}px`,
    minHeight: `${props.h * 80}px`,
    borderRadius: `${(cellPixel.value > 0 ? cellPixel.value : 80) * 0.15}px`,
    backgroundColor: '#ffffff',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
    boxSizing: 'border-box',
    overflow: 'hidden',
    pointerEvents: 'auto',
  }
})
</script>

<template>
  <div class="gcs-panel" :style="panelStyle">
    <slot />
  </div>
</template>

<style scoped>
.gcs-panel {
  color: #fff;
}
</style>
