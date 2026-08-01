<script setup lang="ts">
/**
 * LayerControlPanel - 通用图层控制面板（公共组件）
 *
 * 职责：
 * 1. 显示图层按钮（2列网格布局）
 * 2. 接入真实图层管理（useLayerManager）
 * 3. 底图互斥（影像/矢量只能选一个）
 * 4. 业务图层无互斥（可多选）
 *
 * 被引用：首页、选址分析、浸没分析
 */

import { computed } from 'vue'

import { useGCS } from '@/core/layout/useGCS.js'
import { useBusinessLayers } from '@/core/map/composables/useBusinessLayers'
import { useLayerManager } from '@/core/map/composables/useLayerManager'

const { layerCatalog, toggleLayer } = useLayerManager()
const { manager: businessLayerManager } = useBusinessLayers()
const { cellPixel, css } = useGCS()
// 解构出 CSS 变量供 v-bind() 使用
const { cell8px } = css

/** 按钮尺寸：1.8宽 × 0.8高（cell单位） */
const btnWidthCss = computed(() => `${cellPixel.value * 1.8}px`) // 144px
const btnHeightCss = computed(() => `${cellPixel.value * 0.8}px`) // 64px
/** 字体大小：0.175cell = 14px（基准），0.1cell = 8px（小字） */
const labelFontSizeCss = computed(() => `${cellPixel.value * 0.175}px`) // 14px
const iconFontSizeCss = computed(() => `${cellPixel.value * 0.2}px`) // 16px

/** 图层按钮列表（按显示顺序） */
const layerButtons = computed(() => {
  // 优先按预定义顺序显示，未匹配的图层追加到末尾
  const order = [
    'base-image',
    'base-vector',
    'boundary',
    'ports',
    'analysis-coverage',
    'analysis-matched',
    'flood-water-surface',
    'flood-area',
    'flood-facilities',
    'forecast-cargo',
    'forecast-berth',
    'forecast-traffic',
    'forecast-container',
  ]
  const ordered = order
    .map((key) => layerCatalog.value.find((l: any) => l.key === key))
    .filter(Boolean)
  const orderedKeys = new Set(ordered.map((l: any) => l.key))
  const extra = layerCatalog.value.filter((l: any) => !orderedKeys.has(l.key))
  return [...ordered, ...extra].map((layer) => ({
    key: layer!.key,
    label: layer!.label,
    active: layer!.visible,
  }))
})

/** 图层图标映射 */
function getLayerIcon(label: string): string {
  if (label.includes('底图') || label.includes('影像') || label.includes('矢量')) return '🗺'
  if (label.includes('港口')) return ''
  if (label.includes('行政')) return ''
  if (label.includes('覆盖') || label.includes('缓冲')) return '◎'
  if (label.includes('匹配') || label.includes('结果')) return '◈'
  if (label.includes('水面')) return ''
  if (label.includes('淹没')) return '🌊'
  if (label.includes('设施')) return '🏭'
  if (
    label.includes('预测') ||
    label.includes('吞吐') ||
    label.includes('泊位') ||
    label.includes('流量') ||
    label.includes('压力')
  )
    return '📈'
  return ''
}

/** 点击图层按钮 */
function handleToggle(key: string) {
  // 业务图层（有 layerType 字段，无 show/hide 回调）→ 走 Manager.setVisible
  const catalogEntry = layerCatalog.value.find((e: any) => e.key === key)
  if (catalogEntry && catalogEntry.layerType) {
    businessLayerManager.setVisible(key, !catalogEntry.visible)
    return
  }
  // 底图、边界、港口等旧机制图层 → 走原来的 toggleLayer
  toggleLayer(key)
}
</script>

<template>
  <div class="layer-panel">
    <div class="layer-grid">
      <button
        v-for="item in layerButtons"
        :key="item.key"
        class="layer-btn"
        :class="{ active: item.active }"
        @click="handleToggle(item.key)"
      >
        <span class="layer-icon">{{ getLayerIcon(item.label) }}</span>
        <span class="layer-label">{{ item.label }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.layer-panel {
  width: 100%;
  height: 100%;
  padding: v-bind(cell8px);
  box-sizing: border-box;
}

/* 图层按钮网格：2列，自动行数 */
.layer-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: v-bind(cell8px);
  height: 100%;
  align-content: start;
}

.layer-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: v-bind(cell8px);
  width: v-bind(btnWidthCss);
  height: v-bind(btnHeightCss);
  border: 1px solid var(--GCS-border-default);
  border-radius: var(--GCS-radius-lg);
  background: var(--GCS-bg-panel);
  color: var(--GCS-text-regular);
  cursor: pointer;
  font-size: v-bind(labelFontSizeCss);
  transition: all 0.2s ease;
  padding: v-bind(cell8px) 4px;
  box-sizing: border-box;
  justify-self: center;
}

.layer-btn:hover {
  border-color: var(--GCS-color-primary);
  background: var(--GCS-bg-hover);
}

.layer-btn.active {
  background: var(--GCS-color-primary);
  color: var(--GCS-text-inverse);
  border-color: var(--GCS-color-primary);
}

.layer-icon {
  font-size: v-bind(iconFontSizeCss);
  line-height: 1;
}

.layer-label {
  font-weight: 500;
  line-height: 1.2;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
</style>
