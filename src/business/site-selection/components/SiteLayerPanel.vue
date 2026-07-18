<script setup>
/**
 * SiteLayerPanel - 选址分析图层控制面板
 *
 * 职责：
 * 1. 显示 8 个图层按钮（2 列 × 4 行）
 * 2. 接入真实图层管理（useLayerManager）
 * 3. 底图互斥（影像/矢量只能选一个）
 * 4. 业务图层无互斥（可多选）
 *
 * 图层列表（8 个）：
 * - 影像底图（base-image，底图类）
 * - 矢量底图（base-vector，底图类）
 * - 行政区划（boundary，业务类）
 * - 港口位置（ports，业务类）
 * - 选址缓冲区（analysis-buffer，业务类）
 * - 选址结果（analysis-result，业务类）
 * - 热力图（heatmap，业务类，占位）
 * - 雷达图（radar，业务类，占位）
 */

import { computed } from 'vue'
import { useLayerManager } from '@/core/map/composables/useLayerManager'

const { layerCatalog, toggleLayer } = useLayerManager()

/** 图层按钮列表（按显示顺序） */
const layerButtons = computed(() => {
  const order = [
    'base-image',
    'base-vector',
    'boundary',
    'ports',
    'analysis-coverage',
    'analysis-matched',
  ]
  return order
    .map((key) => layerCatalog.value.find((l) => l.key === key))
    .filter(Boolean)
    .map((layer) => ({
      key: layer.key,
      label: layer.label,
      active: layer.visible,
    }))
})

/** 图层图标映射 */
function getLayerIcon(label) {
  if (label.includes('底图') || label.includes('影像') || label.includes('矢量')) return '🗺'
  if (label.includes('港口')) return ''
  if (label.includes('行政')) return ''
  if (label.includes('覆盖') || label.includes('缓冲')) return '◎'
  if (label.includes('匹配') || label.includes('结果')) return '◈'
  return ''
}

/** 点击图层按钮 */
function handleToggle(key) {
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
  padding: 10px;
  box-sizing: border-box;
}

/* 图层按钮网格：2 列 × 4 行 */
.layer-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: repeat(4, 1fr);
  gap: 10px;
  height: 100%;
}

.layer-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border: 1px solid #e0e0e0;
  border-radius: 12px;
  background: #ffffff;
  color: #333;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.2s ease;
  padding: 6px 4px;
  box-sizing: border-box;
}

.layer-btn:hover {
  border-color: #409eff;
  background: #f0f7ff;
}

.layer-btn.active {
  background: #409eff;
  color: #fff;
  border-color: #409eff;
}

.layer-icon {
  font-size: 16px;
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
