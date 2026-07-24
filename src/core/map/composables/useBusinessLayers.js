/**
 * useBusinessLayers
 *
 * Vue composable: inject BusinessLayerManager 实例。
 * 业务模块通过此 composable 获取 manager，不直接访问 renderer。
 *
 * 使用方式：
 *   const { manager } = useBusinessLayers()
 *   manager.register('my-layer', { label: 'xxx', layerType: 'heatmap', data: [...] })
 */

import { inject } from 'vue'

export const BUSINESS_LAYER_MANAGER_KEY = Symbol('businessLayerManager')

export function useBusinessLayers() {
  const manager = inject(BUSINESS_LAYER_MANAGER_KEY)

  if (!manager) {
    console.warn('[useBusinessLayers] BusinessLayerManager 未注入，请确认 UnifiedMap 已 provide')
    return {
      manager: {
        register: () => {},
        updateData: () => {},
        setVisible: () => {},
        remove: () => {},
        has: () => false,
        removeAll: () => {},
        getMeta: () => null,
      },
    }
  }

  return { manager }
}
