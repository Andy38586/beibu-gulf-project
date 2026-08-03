import type { ComputedRef } from 'vue'
import { computed, inject } from 'vue'

import type { MapRenderer } from '@/core/map/renderers/MapRenderer'
import { MAP_STORE_KEY } from '@/core/provideKeys'
import { logger } from '@/shared'
import { useMapStore } from '@/stores'
import type { LayerEntry, ToggleableHandler } from '@/types'

/** mapStore 实例类型（由 useMapStore 推断） */
type MapStore = ReturnType<typeof useMapStore>

/**
 * 渲染器底图切换能力（OL/Cesium 子类实现，基类 MapRenderer 未声明该方法）
 * registerBaseLayerWithRenderer 接收的 renderer 运行时为 OLRenderer/CesiumRenderer 实例，
 * 静态类型为基类 MapRenderer，故在此用结构化接口描述所需能力。
 */
interface RendererWithBaseLayer {
  setBaseLayer: (type: string) => void
}

/** useLayerManager 返回值 */
interface UseLayerManagerReturn {
  clearLayers: () => void
  registerBaseLayer: (key: string, label: string, show: () => void, hide: () => void) => void
  registerBaseLayerWithRenderer: (key: string, label: string, renderer: MapRenderer) => void
  registerToggleable: (
    key: string,
    label: string,
    rendererOrShow: ToggleableHandler,
    hide?: (() => void) | undefined,
    visible?: boolean
  ) => void
  toggleLayer: (key: string) => void
  layerCatalog: ComputedRef<LayerEntry[]>
}

// 图层管理 composable：通过 inject(MAP_STORE_KEY) 解耦
export function useLayerManager(): UseLayerManagerReturn {
  const store = inject<MapStore>(MAP_STORE_KEY)

  if (!store) {
    logger.warn('[useLayerManager] mapStore 未注入，请在父组件中提供')
    return {
      clearLayers: () => {},
      registerBaseLayer: () => {},
      registerBaseLayerWithRenderer: () => {},
      registerToggleable: () => {},
      toggleLayer: () => {},
      layerCatalog: computed<LayerEntry[]>(() => []),
    }
  }

  const s = store // store 已在上方 null-check 通过，闭包内用 s 引用避免 TS narrowing 失效
  const layerCatalog = computed(() => s.layerCatalog)

  function clearLayers(): void {
    s.clearLayerCatalog()
  }

  function registerBaseLayer(key: string, label: string, show: () => void, hide: () => void): void {
    s.registerBaseLayer(key, label, show, hide)
  }

  function registerToggleable(
    key: string,
    label: string,
    rendererOrShow: ToggleableHandler,
    hide?: (() => void) | undefined,
    visible?: boolean
  ): void {
    if (typeof rendererOrShow === 'object' && rendererOrShow.setVisibility) {
      s.registerToggleable(
        key,
        label,
        () => rendererOrShow.setVisibility(key, true),
        () => rendererOrShow.setVisibility(key, false),
        visible
      )
    } else {
      s.registerToggleable(key, label, rendererOrShow, hide, visible)
    }
  }

  function registerBaseLayerWithRenderer(key: string, label: string, renderer: MapRenderer): void {
    const showFn = (): void => {
      ;(renderer as unknown as RendererWithBaseLayer).setBaseLayer(
        key === 'base-image' ? 'image' : 'vector'
      )
    }
    const hideFn = (): void => {}

    s.registerBaseLayer(key, label, showFn, hideFn)
  }

  function toggleLayer(key: string): void {
    s.toggleLayer(key)
  }

  return {
    clearLayers,
    registerBaseLayer,
    registerBaseLayerWithRenderer,
    registerToggleable,
    toggleLayer,
    layerCatalog,
  }
}
