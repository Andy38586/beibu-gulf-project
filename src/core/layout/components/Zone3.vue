<script>
export default { name: 'GcsZone3' }
</script>

<script setup>
/**
 * Zone3 - 图层控制区（左下）
 *
 * 职责：承载底图切换、业务图层开关等图层控制按钮。
 * Phase 3-B：接入 useLayerManager，从 layerCatalog 动态渲染图层开关。
 * 底图由 store 内部处理互斥，业务图层可多选。
 */

import { computed } from 'vue'
import GcsPanel from './GcsPanel.vue'
import GcsButton from './GcsButton.vue'
import { useLayerManager } from '@/composables/useLayerManager'
import { GAP } from '../config.js'

const { layerCatalog, toggleLayer } = useLayerManager()

const baseLayers = computed(() => layerCatalog.value.filter((e) => e.category === 'base'))
const businessLayers = computed(() => layerCatalog.value.filter((e) => e.category === 'business'))

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
    <div class="button-grid" :style="{ gap: `${GAP}px` }">
      <GcsButton
        v-for="item in baseLayers"
        :key="item.key"
        :label="item.label"
        :icon="getLayerIcon(item.label)"
        :active="item.visible"
        @click="toggleLayer(item.key)"
      />
      <GcsButton
        v-for="item in businessLayers"
        :key="item.key"
        :label="item.label"
        :icon="getLayerIcon(item.label)"
        :active="item.visible"
        @click="toggleLayer(item.key)"
      />
    </div>
  </GcsPanel>
</template>

<style scoped>
.zone-layer {
  width: 100%;
  height: 100%;
}

.button-grid {
  width: 100%;
  height: 100%;
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
}
</style>
