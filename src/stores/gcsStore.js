import { defineStore } from 'pinia'
import { useWaterLevelStore } from './waterLevelStore'
import { useProfileStore } from './profileStore'
import { useFloodStore } from './floodStore'
import { usePortImpactStore } from './portImpactStore'

export const useGcsStore = defineStore('gcs', () => {
  const waterLevelStore = useWaterLevelStore()
  const profileStore = useProfileStore()
  const floodStore = useFloodStore()
  const portImpactStore = usePortImpactStore()

  function resetAll() {
    waterLevelStore.resetWaterLevel()
    profileStore.resetProfile()
    floodStore.resetFloodAnalysis()
    portImpactStore.resetPortImpact()
  }

  return { resetAll }
})
