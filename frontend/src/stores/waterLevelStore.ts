import { defineStore } from 'pinia'
import type { Ref } from 'vue'
import { ref } from 'vue'

export const useWaterLevelStore = defineStore('waterLevel', () => {
  const waterLevel: Ref<number> = ref(0)
  const waterLevelActive: Ref<boolean> = ref(false)

  // LIF-3：*Active 单向置位——0 显式同步为 false
  function setWaterLevel(level: number): void {
    waterLevel.value = level
    waterLevelActive.value = level > 0
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
