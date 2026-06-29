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
  <div class="panel-stack">
    <BufferControl @result-update="handleResult" />
    <ResultPanel :matched-xiaoqu="matchedXiaoqu" :selected-types="selectedTypes" />
  </div>
</template>
