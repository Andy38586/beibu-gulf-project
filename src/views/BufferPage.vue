<script setup>
import { ref, onMounted } from 'vue'
import MapContainer from '@/components/map/MapContainer.vue'
import BufferControl from '@/components/analysis/BufferControl.vue'

const ports = ref([])
const mapRef = ref(null)

onMounted(async () => {
  const res = await fetch('/data/ports.json')
  ports.value = await res.json()
})
</script>

<template>
  <div class="buffer-page">
    <MapContainer ref="mapRef" style="width: 100%; height: 100%" />
    <BufferControl
      :ports="ports"
      @buffer-result="(list) => mapRef?.setBuffers(list)"
      @overlay-result="(geojson) => mapRef?.setOverlayResult(geojson)"
    />
  </div>
</template>

<style scoped>
.buffer-page {
  width: 100%;
  height: 100%;
}
</style>
