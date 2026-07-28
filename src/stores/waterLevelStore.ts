import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Ref } from 'vue'

export const useWaterLevelStore = defineStore('waterLevel', () => {
  const waterLevel: Ref<number> = ref(0)
  const waterLevelActive: Ref<boolean> = ref(false)

  function setWaterLevel(level: number): void {
    waterLevel.value = level
    if (level > 0) {
      waterLevelActive.value = true
    }
  }

  function resetWaterLevel(): void {
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
