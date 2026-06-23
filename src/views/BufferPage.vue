<script setup>
import { ref } from 'vue'
import MapContainer from '@/components/map/MapContainer.vue'
import BufferControl from '@/components/analysis/BufferControl.vue'

const mapRef = ref(null)
</script>

<template>
  <div class="buffer-page">
    <MapContainer ref="mapRef" style="width: 100%; height: 100%" />
    <BufferControl @result-update="(result) => mapRef?.setAnalysisResult(result)" />
  </div>
</template>

<style scoped>
.buffer-page {
  width: 100%;
  height: 100%;
}
</style>
