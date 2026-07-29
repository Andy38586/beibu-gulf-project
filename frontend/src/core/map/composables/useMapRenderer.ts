import type { InjectionKey, Ref } from 'vue'
import { inject, unref } from 'vue'

import type { MapRenderer } from '@/core/map/renderers/MapRenderer'

export const MapRendererKey: InjectionKey<Ref<MapRenderer | null>> = Symbol('mapRenderer')

export function useMapRenderer(): MapRenderer | null {
  const rendererRef = inject(MapRendererKey)
  if (!rendererRef) {
    throw new Error('useMapRenderer 必须在 UnifiedMap 组件内部使用')
  }
  return unref(rendererRef)
}
