<script setup>
import { ref } from 'vue'
import MapContainer from '@/components/map/MapContainer.vue'
import BufferControl from '@/components/analysis/BufferControl.vue'
import ResultPanel from '@/components/analysis/ResultPanel.vue'

const mapRef = ref(null)
const matchedXiaoqu = ref([])
const selectedTypes = ref([])

function handleResult(result) {
  mapRef.value?.setAnalysisResult(result)
  matchedXiaoqu.value = result.matchedXiaoqu || []
  selectedTypes.value = result.selectedTypes || []
}
</script>

<template>
  <div class="buffer-page">
    <MapContainer ref="mapRef" style="width: 100%; height: 100%" />
    <BufferControl @result-update="handleResult" />
    <ResultPanel :matched-xiaoqu="matchedXiaoqu" :selected-types="selectedTypes" />
  </div>
</template>

<style scoped>
.buffer-page {
  width: 100%;
  height: 100%;
}
</style>
