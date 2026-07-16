<script>
export default { name: 'GcsZone3' }
</script>

<script setup>
/**
 * Zone3 - 图层控制区（左下）
 *
 * 职责：承载底图切换、业务图层开关等图层控制按钮。
 * 结构规范：4×1 标题栏 + 2×1 底图切换区 + 2×1 业务图层区。
 * 底图由 store 内部处理互斥，业务图层可多选。
 */

import { computed } from 'vue'
import GcsPanel from './GcsPanel.vue'
import GcsButton from './GcsButton.vue'
import TitlePanel from './TitlePanel.vue'
import { useLayerManager } from '@/core/map/composables/useLayerManager'
import { useGCS } from '../useGCS.js'
import { GAP } from '../config.js'

const { layerCatalog, toggleLayer } = useLayerManager()
const { cellPixel } = useGCS()

const baseLayers = computed(() => layerCatalog.value.filter((e) => e.category === 'base'))
const businessLayers = computed(() => layerCatalog.value.filter((e) => e.category === 'business'))

const labelStyle = computed(() => ({
  fontSize: `${cellPixel.value * 0.18}px`,
  color: 'rgba(255, 255, 255, 0.85)',
  fontWeight: 500,
}))

function getLayerIcon(label) {
  if (label.includes('底图') || label.includes('影像') || label.includes('矢量')) return '🗺'
  if (label.includes('港口')) return '⚓'
  if (label.includes('航线')) return '✈'
  if (label.includes('行政') || label.includes('边界')) return '⛭'
  return '◈'
}
</script>

<template>
  <GcsPanel :w="4" :h="4" class="zone-layer">
    <div class="layer-layout" :style="{ gap: `${GAP}px` }">
      <!-- 4×1 标题栏：明确当前面板为图层控制 -->
      <TitlePanel title="图层控制" class="layer-title" />

      <!-- 底图切换区：底图互斥，由 store 保证同一时刻仅一个底图可见 -->
      <div class="layer-section">
        <span class="section-label" :style="labelStyle">底图</span>
        <div class="button-row" :style="{ gap: `${GAP}px` }">
          <GcsButton
            v-for="item in baseLayers"
            :key="item.key"
            :label="item.label"
            :icon="getLayerIcon(item.label)"
            :active="item.visible"
            @click="toggleLayer(item.key)"
          />
        </div>
      </div>

      <!-- 业务图层区：可多选，独立控制显示/隐藏 -->
      <div class="layer-section">
        <span class="section-label" :style="labelStyle">业务图层</span>
        <div class="button-row" :style="{ gap: `${GAP}px` }">
          <GcsButton
            v-for="item in businessLayers"
            :key="item.key"
            :label="item.label"
            :icon="getLayerIcon(item.label)"
            :active="item.visible"
            @click="toggleLayer(item.key)"
          />
        </div>
      </div>
    </div>
  </GcsPanel>
</template>

<style scoped>
.zone-layer {
  width: 100%;
  height: 100%;
}

.layer-layout {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.layer-title {
  flex: none;
}

.layer-section {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.section-label {
  flex: none;
  margin-bottom: 4px;
}

.button-row {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
}
</style>
