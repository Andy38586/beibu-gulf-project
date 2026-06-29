<script setup>
import { ref } from 'vue'
import BufferControl from '@/components/analysis/BufferControl.vue'
import ResultPanel from '@/components/analysis/ResultPanel.vue'
import { useMapStore } from '@/stores/map'

const mapStore = useMapStore()
const matchedXiaoqu = ref([])
const selectedTypes = ref([])

function handleResult(result) {
  mapStore.setAnalysisResult(result)
  matchedXiaoqu.value = result.matchedXiaoqu || []
  selectedTypes.value = result.selectedTypes || []
}
</script>

<template>
  <div class="buffer-panel">
    <div class="panel-card">
      <BufferControl @result-update="handleResult" />
    </div>
    <div class="panel-card">
      <ResultPanel :matched-xiaoqu="matchedXiaoqu" :selected-types="selectedTypes" />
    </div>
  </div>
</template>

<style scoped>
.buffer-panel {
  position: fixed;
  top: 70px;
  right: 20px;
  width: 280px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  z-index: 40;
  pointer-events: auto;
}
.panel-card {
  background: rgba(255, 255, 255, 0.98);
  border-radius: 10px;
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.2);
  padding: 15px;
  overflow: hidden;
}
</style>