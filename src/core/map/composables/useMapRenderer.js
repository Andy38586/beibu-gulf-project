import { inject, unref } from 'vue'

export const MapRendererKey = Symbol('mapRenderer')

export function useMapRenderer() {
  const rendererRef = inject(MapRendererKey)
  if (!rendererRef) {
    throw new Error('useMapRenderer 必须在 UnifiedMap 组件内部使用')
  }
  return unref(rendererRef)
}
