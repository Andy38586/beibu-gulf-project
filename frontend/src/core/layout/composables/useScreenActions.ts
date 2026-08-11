/**
 * useScreenActions - 全局屏幕操作封装
 * 封装钦州/防城港/北海三个城市的地图 flyTo 回调；
 * 城市坐标来自 MAP_CONFIG.CITY_CENTERS（单一权威源），不硬编码。
 */

import { MAP_CONFIG } from '@/core/config/map'
import { useMapControls } from '@/core/map/composables/useMapControls'

/** useScreenActions 返回值结构 */
export interface UseScreenActionsReturn {
  flyToCity: (city: string) => void
}

export function useScreenActions(): UseScreenActionsReturn {
  const { flyTo } = useMapControls()

  /** 飞行到指定城市中心并放大 zoom（city：钦州/防城港/北海） */
  function flyToCity(city: string): void {
    const target = MAP_CONFIG.CITY_CENTERS[city]
    if (!target) return
    flyTo({ lng: target.lng, lat: target.lat }, { height: target.height, zoom: target.zoom })
  }

  return {
    flyToCity,
  }
}
