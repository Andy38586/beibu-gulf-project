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
      影像底图
    </button>
    <button
      :class="{ active: mapStore.activeBaseMap === 'vector' }"
      @click="mapStore.switchBaseMap('vector')"
    >
      矢量底图
    </button>
  </div>
</template>

<style scoped>
.base-switcher {
  position: absolute;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 40;
  background: rgba(44, 62, 80, 0.85);
  backdrop-filter: blur(10px);
  border-radius: 30px;
  padding: 4px;
  display: flex;
  gap: 4px;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
}
.base-switcher button {
  border: none;
  background: transparent;
  padding: 8px 20px;
  border-radius: 26px;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  transition: all 0.2s;
}
.base-switcher button:hover {
  background: rgba(255, 255, 255, 0.1);
  color: white;
}
.base-switcher button.active {
  background: white;
  color: #34495e;
  font-weight: 500;
}
</style>
