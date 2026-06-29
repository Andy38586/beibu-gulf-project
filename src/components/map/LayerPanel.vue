<script setup>
import { ref } from 'vue'
import { useLayerManager } from '@/composables/useLayerManager'

const { layerCatalog, toggleLayer } = useLayerManager()
const isExpanded = ref(false)

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
      <label v-for="item in layerCatalog" :key="item.key" class="layer-item">
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
</template>

<style scoped>
.layer-panel {
  position: absolute;
  top: 70px;
  left: 10px;
  z-index: 40;
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(10px);
  border-radius: 10px;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.15);
  overflow: hidden;
  min-width: 160px;
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
