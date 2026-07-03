<script setup>
import { ref, computed } from 'vue'
import { useLayerManager } from '@/composables/useLayerManager'

const { layerCatalog, toggleLayer } = useLayerManager()
const isExpanded = ref(false)

const baseLayers = computed(() => layerCatalog.value.filter((e) => e.category === 'base'))
const businessLayers = computed(() => layerCatalog.value.filter((e) => e.category === 'business'))

function togglePanel() {
  isExpanded.value = !isExpanded.value
}
</script>

<template>
  <div class="layer-panel">
    <div class="panel-header" @click="togglePanel">
      <span class="panel-title">图层控制</span>
      <span class="panel-toggle">{{ isExpanded ? '▼' : '▶' }}</span>
    </div>
    <div v-show="isExpanded" class="panel-content">
      <div class="base-map-section">
        <span class="section-title">底图</span>
        <label v-for="item in baseLayers" :key="item.key" class="layer-item">
          <input
            type="checkbox"
            :checked="item.visible"
            @change="toggleLayer(item.key)"
            class="layer-checkbox"
          />
          <span class="layer-label">{{ item.label }}</span>
        </label>
      </div>
      <div class="divider"></div>
      <div class="business-layers-section">
        <span class="section-title">业务图层</span>
        <label v-for="item in businessLayers" :key="item.key" class="layer-item">
          <input
            type="checkbox"
            :checked="item.visible"
            @change="toggleLayer(item.key)"
            class="layer-checkbox"
          />
          <span class="layer-label">{{ item.label }}</span>
        </label>
      </div>
    </div>
  </div>
</template>

<style scoped>
.layer-panel {
  position: absolute;
  top: calc(9 * var(--unit));
  left: calc(1.25 * var(--unit));
  z-index: 100;
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(10px);
  border-radius: calc(1.25 * var(--unit));
  box-shadow: 0 calc(0.5 * var(--unit)) calc(2 * var(--unit)) rgba(0, 0, 0, 0.15);
  overflow: hidden;
  width: calc(39 * var(--unit));
  pointer-events: auto;
}
.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  cursor: pointer;
  background: rgba(44, 62, 80, 0.05);
}
.panel-header:hover {
  background: rgba(44, 62, 80, 0.1);
}
.panel-title {
  font-size: 13px;
  font-weight: 500;
  color: #34495e;
}
.panel-toggle {
  font-size: 10px;
  color: #999;
  transition: transform 0.2s;
}
.panel-content {
  padding: 8px 0;
}
.section-title {
  font-size: 12px;
  color: #999;
  padding: 4px 12px;
  margin-bottom: 4px;
  display: block;
}
.base-map-section {
  padding: 4px 0;
}
.divider {
  height: 1px;
  background: #eee;
  margin: 8px 0;
}
.business-layers-section {
  padding: 4px 0;
}
.layer-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  cursor: pointer;
  font-size: 13px;
  color: #555;
  transition: background 0.15s;
}
.layer-item:hover {
  background: rgba(64, 158, 255, 0.1);
}
.layer-checkbox {
  width: 14px;
  height: 14px;
  accent-color: #409eff;
  cursor: pointer;
}
.layer-label {
  flex: 1;
}
</style>
