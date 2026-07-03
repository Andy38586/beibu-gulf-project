<script setup>
import InfoPanel from '@/components/common/InfoPanel.vue'
import { useMapStore } from '@/stores/map'

const mapStore = useMapStore()
</script>

<template>
  <div class="home-page">
    <InfoPanel v-if="mapStore.selectedPort" :selectedPort="mapStore.selectedPort" />
  </div>
</template>

<style scoped>
.home-page {
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.home-page :deep(.info-panel) {
  pointer-events: auto;
}
</style>