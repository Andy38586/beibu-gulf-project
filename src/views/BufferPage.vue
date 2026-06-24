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
    <MapContainer ref="mapRef" :initial-zoom="11" :min-zoom="9" style="width: 100%; height: 100%" />
    <div class="panel-stack">
      <BufferControl @result-update="handleResult" />
      <ResultPanel :matched-xiaoqu="matchedXiaoqu" :selected-types="selectedTypes" />
    </div>
  </div>
</template>

<style scoped>
.buffer-page {
  width: 100%;
  height: 100%;
  position: relative;
}
.panel-stack {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 300px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
</style>
