import { defineStore } from 'pinia'

import { useFloodState } from './floodState'
import { usePortImpactStore } from './portImpactStore'
import { useProfileStore } from './profileStore'
import { useWaterLevelStore } from './waterLevelStore'

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
