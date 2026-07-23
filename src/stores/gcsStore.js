import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useWaterLevelStore } from './waterLevelStore'
import { useProfileStore } from './profileStore'
import { useFloodStore } from './floodStore'
import { usePortImpactStore } from './portImpactStore'

export const useGcsStore = defineStore('gcs', () => {
  const waterLevelStore = useWaterLevelStore()
  const profileStore = useProfileStore()
  const floodStore = useFloodStore()
  const portImpactStore = usePortImpactStore()

  const activeModule = ref(null)

  function setActiveModule(moduleName) {
    activeModule.value = moduleName
  }

  function resetAll() {
    waterLevelStore.resetWaterLevel()
    profileStore.resetProfile()
    floodStore.resetFloodAnalysis()
    portImpactStore.resetPortImpact()
    activeModule.value = null
  }

  const hasActiveAnalysis = computed(() => {
    return (
      waterLevelStore.waterLevelActive ||
      profileStore.profileActive ||
      floodStore.floodActive ||
      portImpactStore.portImpactActive
    )
  })

  return {
    waterLevel: waterLevelStore.waterLevel,
    waterLevelActive: waterLevelStore.waterLevelActive,
    setWaterLevel: waterLevelStore.setWaterLevel,
    resetWaterLevel: waterLevelStore.resetWaterLevel,
    selectedProfileId: profileStore.selectedProfileId,
    profileActive: profileStore.profileActive,
    setSelectedProfile: profileStore.setSelectedProfile,
    resetProfile: profileStore.resetProfile,
    floodActive: floodStore.floodActive,
    showFloodArea: floodStore.showFloodArea,
    showFloodPOI: floodStore.showFloodPOI,
    floodStatistics: floodStore.floodStatistics,
    floodFeatures: floodStore.floodFeatures,
    floodRiskLevel: floodStore.floodRiskLevel,
    startFloodAnalysis: floodStore.startFloodAnalysis,
    resetFloodAnalysis: floodStore.resetFloodAnalysis,
    portImpactActive: portImpactStore.portImpactActive,
    affectedFacilities: portImpactStore.affectedFacilities,
    totalLoss: portImpactStore.totalLoss,
    setPortImpactResult: portImpactStore.setPortImpactResult,
    resetPortImpact: portImpactStore.resetPortImpact,
    activeModule,
    setActiveModule,
    resetAll,
    hasActiveAnalysis,
  }
})
