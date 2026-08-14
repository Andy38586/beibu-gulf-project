<script setup lang="ts">
/**
 * 雷达图得分详情面板：点击「综合评分」后在雷达面板内居中显示（不遮挡底部综合评分）。
 * 布局约定：设施名一列、分数一列（2 列 × 6 行网格），各列内文字居中，两列整体在面板中间居中。
 */

import { computed } from 'vue'

import { FACILITY_COLORS_MAP } from '@/shared'
import { RADAR_TOOLTIP_HEIGHT_CELL } from '@/shared'
import { RADAR_TOOLTIP_WIDTH_CELL } from '@/shared'
import { useGCS } from '@/shared'
import { FACILITY_LABELS } from '@/shared'

interface Props {
  visible?: boolean
  xiaoqu?: { breakdown?: Record<string, number> } | null
  selectedTypes?: string[]
  position?: { left: number; top: number }
}

const props = withDefaults(defineProps<Props>(), {
  visible: false,
  xiaoqu: null,
  selectedTypes: () => [],
  position: () => ({ left: 0, top: 0 }),
})

const { cellPixel } = useGCS()

/** 详情面板尺寸：与 useRadarChart 定位公式共用单一常量（2×3 cell） */
const panelW = computed(() => cellPixel.value * RADAR_TOOLTIP_WIDTH_CELL)
const panelH = computed(() => cellPixel.value * RADAR_TOOLTIP_HEIGHT_CELL)
const unitPx = computed(() => `${cellPixel.value * 0.1}px`)

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
        left: props.position.left + 'px',
        top: props.position.top + 'px',
        width: panelW + 'px',
        height: panelH + 'px',
      }"
    >
      <div class="tooltip-grid">
        <template v-for="key in selectedTypes" :key="key">
          <span class="tooltip-label" :style="{ color: getFacilityColor(key) }">{{
            FACILITY_LABELS[key]
          }}</span>
          <span class="tooltip-value">{{ xiaoqu.breakdown?.[key] ?? 0 }}分</span>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.radar-tooltip {
  position: fixed;
  z-index: var(--GCS-z-panel-float);
  background: var(--GCS-bg-panel);
  border: 1px solid var(--GCS-border-default);
  border-radius: var(--GCS-radius-md);
  box-shadow: var(--GCS-shadow-sm);
  box-sizing: border-box;
}

/* 2 列 × 6 行：左列设施名、右列分数，各列独立居中，列间有间距 */
.tooltip-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-auto-rows: minmax(0, 1fr);
  column-gap: calc(2 * v-bind(unitPx));
  padding: calc(1 * v-bind(unitPx)) calc(2 * v-bind(unitPx));
  width: 100%;
  height: 100%;
  box-sizing: border-box;
}

.tooltip-label,
.tooltip-value {
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  border-bottom: 1px solid var(--GCS-border-light);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tooltip-grid > :nth-last-child(-n + 2) {
  border-bottom: none;
}

.tooltip-label {
  font-weight: 500;
  font-size: 13px;
}

.tooltip-value {
  font-weight: 600;
  font-size: 14px;
  color: var(--GCS-text-primary);
}
</style>
