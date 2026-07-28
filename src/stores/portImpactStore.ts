import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Ref } from 'vue'
import type { AffectedFacility } from '@/types/business/base'

export const usePortImpactStore = defineStore('portImpact', () => {
  const portImpactActive: Ref<boolean> = ref(false)
  const affectedFacilities: Ref<AffectedFacility[]> = ref([])
  const totalLoss: Ref<number> = ref(0)

  function setPortImpactResult(facilities: AffectedFacility[], loss: number): void {
    affectedFacilities.value = facilities
    totalLoss.value = loss
    if (facilities.length > 0) {
      portImpactActive.value = true
    }
  }

  function resetPortImpact(): void {
    portImpactActive.value = false
    affectedFacilities.value = []
    totalLoss.value = 0
  }

  return {
    portImpactActive,
    affectedFacilities,
    totalLoss,
    setPortImpactResult,
    resetPortImpact,
  }
})
