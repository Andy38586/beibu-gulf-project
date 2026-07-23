import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useWaterLevelStore = defineStore('waterLevel', () => {
  const waterLevel = ref(0)
  const waterLevelActive = ref(false)

  function setWaterLevel(level) {
    waterLevel.value = level
    waterLevelActive.value = level > 0
  }

  function resetWaterLevel() {
    waterLevel.value = 0
    waterLevelActive.value = false
  }

  return {
    waterLevel,
    waterLevelActive,
    setWaterLevel,
    resetWaterLevel,
  }
})
