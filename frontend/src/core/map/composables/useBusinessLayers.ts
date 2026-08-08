/**
 * useBusinessLayers
 * Vue composable: inject BusinessLayerManager 实例。
 * 业务模块通过此 composable 获取 manager，不直接访问 renderer。
 * 使用方式：
 * const { manager } = useBusinessLayers()
 * manager.register('my-layer', { label: 'xxx', layerType: 'heatmap', data: [...] })
 */

import type { InjectionKey } from 'vue'
import { inject } from 'vue'

import type { BusinessLayerManager } from '@/core/map/BusinessLayerManager'
import { logger } from '@/shared'

/**
 * useBusinessLayers 返回的 manager 形态
 * 取 BusinessLayerManager 的公开方法子集（与未注入时返回的 no-op 桩保持一致）。
 * 业务组件通过此 composable 仅使用这些方法；reapplyAll 由 UnifiedMap.initRenderer
 * 在引擎初始化/切换尾部调用（业务图层重建的最后一步，见 2026-08-08 顺序修复）。
 */
type BusinessLayerManagerLike = Pick<
  BusinessLayerManager,
  | 'register'
  | 'updateData'
  | 'setVisible'
  | 'remove'
  | 'has'
  | 'removeAll'
  | 'getMeta'
  | 'reapplyAll'
  | 'isLayerVisible'
>

/** useBusinessLayers 返回值 */
interface UseBusinessLayersReturn {
  manager: BusinessLayerManagerLike
}

export const BUSINESS_LAYER_MANAGER_KEY: InjectionKey<BusinessLayerManager> =
  Symbol('businessLayerManager')

export function useBusinessLayers(): UseBusinessLayersReturn {
  const manager = inject(BUSINESS_LAYER_MANAGER_KEY)

  if (!manager) {
    logger.warn('[useBusinessLayers] BusinessLayerManager 未注入，请确认 UnifiedMap 已 provide')
    return {
      manager: {
        register: () => {},
        updateData: () => {},
        setVisible: () => {},
        remove: () => {},
        has: () => false,
        removeAll: () => {},
        getMeta: () => null,
        reapplyAll: () => {},
        isLayerVisible: () => false,
      },
    }
  }

  return { manager }
}
