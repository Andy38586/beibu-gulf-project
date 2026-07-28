import { defineStore } from 'pinia'
import { useWaterLevelStore } from './waterLevelStore'
import { useProfileStore } from './profileStore'
import { useFloodState } from './floodState'
import { usePortImpactStore } from './portImpactStore'

export const useGcsStore = defineStore('gcs', () => {
  function resetAll(): void {
    useWaterLevelStore().resetWaterLevel()
    useProfileStore().resetProfile()
    useFloodState().resetFloodAnalysis()
    usePortImpactStore().resetPortImpact()
  }

  return {
    resetAll,
  }
})
