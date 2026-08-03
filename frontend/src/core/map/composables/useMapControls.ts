import type { ComputedRef } from 'vue'
import { computed, inject } from 'vue'

import { MAP_CONFIG } from '@/core/config/map'
import { UNIFIED_MAP_KEY, type UnifiedMapExposed } from '@/core/provideKeys'
import type { FlyToOptions, FlyToTarget } from '@/types'

/** useMapControls 返回值 */
interface UseMapControlsReturn {
  flyTo: (target: FlyToTarget, options?: FlyToOptions) => void
  startBreathing: (lng: number, lat: number) => void
  stopBreathing: () => void
  zoomToRegion: () => void
  zoomToCity: () => void
  zoomToDistrict: () => void
  mapInstance: ComputedRef<UnifiedMapExposed | null | undefined>
}

export function useMapControls(): UseMapControlsReturn {
  const unifiedMapRef = inject(UNIFIED_MAP_KEY, null)
  const mapInstance = computed(() => unifiedMapRef?.value)

  function flyTo(target: FlyToTarget, options: FlyToOptions = {}): void {
    mapInstance.value?.flyTo(target, options)
  }

  function startBreathing(lng: number, lat: number): void {
    mapInstance.value?.startBreathing(lng, lat)
  }

  function stopBreathing(): void {
    mapInstance.value?.stopBreathing()
  }

  function zoomToRegion(): void {
    const regionLevel = MAP_CONFIG.VIEW_LEVELS.REGION
    flyTo(regionLevel.center, { height: regionLevel.height })
  }

  function zoomToCity(): void {
    const cityLevel = MAP_CONFIG.VIEW_LEVELS.CITY
    flyTo(cityLevel.center, { height: cityLevel.height })
  }

  function zoomToDistrict(): void {
    const districtLevel = MAP_CONFIG.VIEW_LEVELS.DISTRICT
    flyTo(districtLevel.center, { height: districtLevel.height })
  }

  return {
    flyTo,
    startBreathing,
    stopBreathing,
    zoomToRegion,
    zoomToCity,
    zoomToDistrict,
    mapInstance,
  }
}
