/**
 * 注入 BusinessLayerManager（BLM）实例的 composable——业务模块通过它操作图层，
 * 不直接访问 renderer；未注入时返回 no-op 桩。
 */

import type { InjectionKey } from 'vue'
import { inject } from 'vue'

import type { BusinessLayerManager } from '@/core/map/BusinessLayerManager'
import { logger } from '@/shared'

/** 暴露给业务组件的 manager 方法子集（与未注入时的 no-op 桩保持一致） */
export type BusinessLayerManagerLike = Pick<
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
  | 'isNotMounted'
>

/** useBusinessLayers 返回值 */
interface UseBusinessLayersReturn {
  manager: BusinessLayerManagerLike
}

export const BUSINESS_LAYER_MANAGER_KEY: InjectionKey<BusinessLayerManager> =
  Symbol('businessLayerManager')

/**
 * @param manager 显式传入的 manager——给**提供 provide 的那个组件自己**用。
 *
 * **为什么需要它（2026-10-04 运行时实测）**：`App.vue` 既 `provide(BUSINESS_LAYER_MANAGER_KEY)`
 * 又直接消费（`useLayerIRLayer()` 渲染"任务结果拖出上图"）。Vue 的 provide 只对后代生效，
 * App 自己 inject 恒失败 ⇒ 得到 no-op 桩：chip 显示已上图、BLM 里却没有该图层（静默空转），
 * 控制台另有 Vue 的 "injection not found" 告警。App 侧改为显式传 manager。
 */
export function useBusinessLayers(
  manager?: BusinessLayerManagerLike | null
): UseBusinessLayersReturn {
  if (manager) return { manager }
  const injected = inject(BUSINESS_LAYER_MANAGER_KEY)

  if (!injected) {
    logger.warn(
      '[useBusinessLayers] BusinessLayerManager 未注入：App.vue 的 provide 只对后代生效，' +
        '在 App 内使用须显式传入 manager'
    )
    return {
      manager: {
        register: () => {},
        updateData: () => {},
        setVisible: () => {},
        remove: () => {},
        has: () => false,
        removeAll: () => {},
        getMeta: () => null,
        reapplyAll: () => [],
        isLayerVisible: () => false,
        isNotMounted: () => false,
      },
    }
  }

  return { manager: injected }
}
