<script setup>
import { useMapStore } from '@/stores/map'

const mapStore = useMapStore()
</script>

<template>
  <div class="base-switcher">
    <button
      :class="{ active: mapStore.activeBaseMap === 'image' }"
      @click="mapStore.switchBaseMap('image')"
    >
      影像
    </button>
    <button
      :class="{ active: mapStore.activeBaseMap === 'vector' }"
      @click="mapStore.switchBaseMap('vector')"
    >
      矢量
    </button>
  </div>
</template>

<style scoped>
.base-switcher {
  position: absolute;
  bottom: 16px;
  left: 16px;
  z-index: 40;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(6px);
  border-radius: 10px;
  padding: 6px;
  display: flex;
  gap: 4px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.12);
}
.base-switcher button {
  border: none;
  background: transparent;
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
}
.base-switcher button:hover {
  background: #f0f4f8;
}
.base-switcher button.active {
  background: #409eff;
  color: white;
}
</style>
