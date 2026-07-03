import { inject, computed } from 'vue'
import { MAP_CONFIG } from '@/config/map'

export function useMapControls() {
  const unifiedMapRef = inject('unifiedMap', null)
  const mapInstance = computed(() => unifiedMapRef?.value)

  function flyTo(target, options = {}) {
    mapInstance.value?.flyTo(target, options)
  }

  function startBreathing(lng, lat) {
    mapInstance.value?.startBreathing(lng, lat)
  }

  function stopBreathing() {
    mapInstance.value?.stopBreathing()
  }

  function zoomToRegion() {
    const regionLevel = MAP_CONFIG.VIEW_LEVELS.REGION
    flyTo(regionLevel.center, { height: regionLevel.height })
  }

  function zoomToCity() {
    const cityLevel = MAP_CONFIG.VIEW_LEVELS.CITY
    flyTo(cityLevel.center, { height: cityLevel.height })
  }

  function zoomToDistrict() {
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
