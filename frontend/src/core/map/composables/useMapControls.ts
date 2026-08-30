import type { ComputedRef } from 'vue'
import { computed, inject } from 'vue'

import { MAP_CONFIG } from '@/core/config/map'
import { UNIFIED_MAP_KEY, type UnifiedMapExposed } from '@/core/provideKeys'
import type { FlyToOptions, FlyToTarget, GeoPoint } from '@/types'

/** useMapControls 返回值 */
interface UseMapControlsReturn {
  flyTo: (target: FlyToTarget, options?: FlyToOptions) => void
  startBreathing: (target: GeoPoint | GeoPoint[], color?: string) => void
  stopBreathing: () => void
  startFacilityBreathing: (target: Array<GeoPoint & { color?: string }>, color?: string) => void
  stopFacilityBreathing: () => void
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

  function startBreathing(target: GeoPoint | GeoPoint[], color?: string): void {
    mapInstance.value?.startBreathing(target, color)
  }

  function stopBreathing(): void {
    mapInstance.value?.stopBreathing()
  }

  function startFacilityBreathing(
    target: Array<GeoPoint & { color?: string }>,
    color?: string
  ): void {
    mapInstance.value?.startFacilityBreathing(target, color)
  }

  function stopFacilityBreathing(): void {
    mapInstance.value?.stopFacilityBreathing()
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
    startFacilityBreathing,
    stopFacilityBreathing,
    zoomToRegion,
    zoomToCity,
    zoomToDistrict,
    mapInstance,
  }
}
