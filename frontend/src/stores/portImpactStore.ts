import { defineStore } from 'pinia'
import type { Ref } from 'vue'
import { ref } from 'vue'

import type { AffectedFacility } from '@/types/business/base'

export const usePortImpactStore = defineStore('portImpact', () => {
  const portImpactActive: Ref<boolean> = ref(false)
  const affectedFacilities: Ref<AffectedFacility[]> = ref([])
  const totalLoss: Ref<number> = ref(0)

  // LIF-3：*Active 单向置位——空数组显式同步为 false，避免 UI 残留旧激活态
  function setPortImpactResult(facilities: AffectedFacility[], loss: number): void {
    affectedFacilities.value = facilities
    totalLoss.value = loss
    portImpactActive.value = facilities.length > 0
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
