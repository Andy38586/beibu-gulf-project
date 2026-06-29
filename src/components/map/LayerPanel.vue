<script setup>
import { useLayerManager } from '@/composables/useLayerManager'

const { layerCatalog, toggleLayer } = useLayerManager()
</script>

<template>
  <div class="layer-panel">
    <button
      v-for="item in layerCatalog"
      :key="item.key"
      class="layer-dot"
      :class="{ active: item.visible }"
      @click="toggleLayer(item.key)"
      :title="item.label"
    >
      {{ item.label }}
    </button>
  </div>
</template>

<style scoped>
.layer-panel {
  position: absolute;
  bottom: 16px;
  left: 130px;
  z-index: 40;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(6px);
  border-radius: 10px;
  padding: 6px;
  display: flex;
  gap: 6px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.12);
}
.layer-dot {
  border: none;
  background: #ddd;
  color: #888;
  padding: 6px 12px;
  border-radius: 20px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
}
.layer-dot.active {
  background: #409eff;
  color: white;
  box-shadow: 0 0 8px rgba(64, 158, 255, 0.6);
}
</style>
