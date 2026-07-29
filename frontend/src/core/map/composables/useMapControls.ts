import type { ComputedRef, Ref } from 'vue'
import { computed, inject } from 'vue'

import { MAP_CONFIG } from '@/core/config/map'
import type { MapRenderer } from '@/core/map/renderers/MapRenderer'
import type { FlyToOptions, FlyToTarget } from '@/types'

/** UnifiedMap 组件通过 defineExpose 暴露的地图控制接口 */
interface UnifiedMapExposed {
  flyTo: (target: FlyToTarget, options?: FlyToOptions) => void
  startBreathing: (lng: number, lat: number) => void
  stopBreathing: () => void
  getRenderer: () => MapRenderer | null
}

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
  const unifiedMapRef = inject<Ref<UnifiedMapExposed | null> | null>('unifiedMap', null)
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
