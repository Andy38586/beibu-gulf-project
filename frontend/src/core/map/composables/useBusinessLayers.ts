/**
 * 注入 BusinessLayerManager（BLM）实例的 composable——业务模块通过它操作图层，
 * 不直接访问 renderer；未注入时返回 no-op 桩。
 */

import type { InjectionKey } from 'vue'
import { inject } from 'vue'

import type { BusinessLayerManager } from '@/core/map/BusinessLayerManager'
import { logger } from '@/shared'

/** 暴露给业务组件的 manager 方法子集（与未注入时的 no-op 桩保持一致） */
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
