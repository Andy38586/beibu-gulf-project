<script setup lang="ts">
/**
 * RadarScoreTooltip - 雷达图得分弹窗组件
 *
 * 职责：显示雷达图的具体得分（1列6行网格布局）
 * 拆分RadarChart组件
 */

import { computed } from 'vue'

import { FACILITY_COLORS_MAP } from '@/shared'
import { useGCS } from '@/shared'
import { FACILITY_LABELS } from '@/shared'

interface Props {
  visible?: boolean
  xiaoqu?: { breakdown?: Record<string, number> } | null
  selectedTypes?: string[]
  position?: { left: number; top: number }
}

withDefaults(defineProps<Props>(), {
  visible: false,
  xiaoqu: null,
  selectedTypes: () => [],
  position: () => ({ left: 0, top: 0 }),
})

const { cellPixel } = useGCS()

/** 弹窗尺寸：2×3 cell */
const tooltipW = computed(() => cellPixel.value * 2)
const tooltipH = computed(() => cellPixel.value * 3)
const unitPx = computed(() => cellPixel.value * 0.1)

/** 获取设施颜色（从 shared 色值映射取，不依赖 business 层） */
function getFacilityColor(key: string) {
  return FACILITY_COLORS_MAP[key] || '#666'
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible && xiaoqu && selectedTypes.length > 0"
      class="radar-tooltip"
      :style="{
        left: position.left + 'px',
        top: position.top + 'px',
        width: tooltipW + 'px',
        height: tooltipH + 'px',
      }"
    >
      <div class="tooltip-grid">
        <div
          v-for="key in selectedTypes"
          :key="key"
          class="tooltip-item"
          :style="{ color: getFacilityColor(key) }"
        >
          <span class="tooltip-label">{{ FACILITY_LABELS[key] }}</span>
          <span class="tooltip-value">{{ xiaoqu.breakdown?.[key] ?? 0 }}分</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.radar-tooltip {
  position: fixed;
  z-index: 1000;
  background: rgba(255, 255, 255, 0.98);
  border: 1px solid var(--GCS-border-default);
  border-radius: 8px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
  box-sizing: border-box;
}

.tooltip-grid {
  display: grid;
  grid-template-columns: 1fr;
  grid-template-rows: repeat(6, 1fr);
  width: 100%;
  height: 100%;
}

.tooltip-item {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 0 calc(1 * v-bind(unitPx));
  font-size: 15px;
  border-bottom: 1px solid var(--GCS-border-light);
}

.tooltip-item:last-child {
  border-bottom: none;
}

.tooltip-label {
  font-weight: 500;
  font-size: 14px;
}

.tooltip-value {
  font-weight: 600;
  font-size: 15px;
}
</style>
