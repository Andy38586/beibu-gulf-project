<script setup>
import { ref, onUnmounted } from 'vue'
import MapContainer from '@/components/map/MapContainer.vue'
import BufferControl from '@/components/analysis/BufferControl.vue'
import ResultPanel from '@/components/analysis/ResultPanel.vue'

const mapRef = ref(null)
const matchedXiaoqu = ref([])
const selectedTypes = ref([])

const isUnmounted = ref(false)
onUnmounted(() => { isUnmounted.value = true })

function handleResult(result) {
  if (isUnmounted.value) {
    console.warn('[BufferPage] 组件已卸载，丢弃分析结果')
    return
  }
  if (mapRef.value) {
    mapRef.value.setAnalysisResult(result)
  } else {
    console.warn('[BufferPage] MapContainer 尚未就绪，结果无法在地图展示')
  }
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
  top: 66px;
  right: 10px;
  width: 300px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
</style>
