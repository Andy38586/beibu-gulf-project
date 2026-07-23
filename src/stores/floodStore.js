import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useFloodStore = defineStore('flood', () => {
  const floodActive = ref(false)
  const showFloodArea = ref(false)
  const showFloodPOI = ref(false)
  const floodStatistics = ref(null)
  const floodFeatures = ref([])
  const floodRiskLevel = ref('')

  function startFloodAnalysis(statistics, features, riskLevel) {
    floodActive.value = true
    showFloodArea.value = true
    showFloodPOI.value = true
    floodStatistics.value = statistics || null
    floodFeatures.value = features || []
    floodRiskLevel.value = riskLevel || ''
  }

  function resetFloodAnalysis() {
    floodActive.value = false
    showFloodArea.value = false
    showFloodPOI.value = false
    floodStatistics.value = null
    floodFeatures.value = []
    floodRiskLevel.value = ''
  }

  return {
    floodActive,
    showFloodArea,
    showFloodPOI,
    floodStatistics,
    floodFeatures,
    floodRiskLevel,
    startFloodAnalysis,
    resetFloodAnalysis,
  }
})
