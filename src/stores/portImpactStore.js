import { defineStore } from 'pinia'
import { ref } from 'vue'

export const usePortImpactStore = defineStore('portImpact', () => {
  const portImpactActive = ref(false)
  const affectedFacilities = ref([])
  const totalLoss = ref(0)

  function setPortImpactResult(facilities, loss) {
    affectedFacilities.value = facilities
    totalLoss.value = loss
    portImpactActive.value = facilities.length > 0
  }

  function resetPortImpact() {
    affectedFacilities.value = []
    totalLoss.value = 0
    portImpactActive.value = false
  }

  return {
    portImpactActive,
    affectedFacilities,
    totalLoss,
    setPortImpactResult,
    resetPortImpact,
  }
})
