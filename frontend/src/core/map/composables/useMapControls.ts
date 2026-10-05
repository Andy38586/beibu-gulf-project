import type { ComputedRef, Ref } from 'vue'
import { computed, inject } from 'vue'

import { MAP_CONFIG } from '@/core/config/map'
import { UNIFIED_MAP_KEY, type UnifiedMapExposed } from '@/core/provideKeys'
import type { FlyToOptions, FlyToTarget, GeoPoint } from '@/types'

/** useMapControls 返回值 */
interface UseMapControlsReturn {
  flyTo: (target: FlyToTarget, options?: FlyToOptions) => void
  startBreathing: (target: GeoPoint | GeoPoint[], color?: string) => void
  stopBreathing: () => void
  startFacilityBreathing: (target: Array<GeoPoint & { color?: string }>, color?: string) => void
  stopFacilityBreathing: () => void
  zoomToRegion: () => void
  mapInstance: ComputedRef<UnifiedMapExposed | null | undefined>
}

/**
 * @param mapRef 显式传入的 UnifiedMap 暴露接口。
 *
 * **为什么需要它（2026-10-04 运行时实测）**：`App.vue` 自己 `provide` 的 `UNIFIED_MAP_KEY`
 * 对**它自己不可注入**（Vue 的 provide 只对后代生效）⇒ App 内 `useMapControls()` 恒拿到
 * `null`，`zoomToRegion()` 静默空转（实测：Profile(z9) 手动缩放后 push('/')，视图停在 z6
 * 而不复位到 REGION z9）。App 侧改为显式传 `unifiedMapRef`；后代组件（provide 可见）
 * 仍走 inject 分支，行为不变。
 */
export function useMapControls(
  mapRef?: Ref<UnifiedMapExposed | null> | null
): UseMapControlsReturn {
  // 显式传入优先（App 自身场景）；`??` 短路保证这条路径不再触发 inject 的失败告警
  const unifiedMapRef = mapRef ?? inject(UNIFIED_MAP_KEY, null)
  const mapInstance = computed(() => unifiedMapRef?.value)

  function flyTo(target: FlyToTarget, options: FlyToOptions = {}): void {
    mapInstance.value?.flyTo(target, options)
  }

  function startBreathing(target: GeoPoint | GeoPoint[], color?: string): void {
    mapInstance.value?.startBreathing(target, color)
  }

  function stopBreathing(): void {
    mapInstance.value?.stopBreathing()
  }

  function startFacilityBreathing(
    target: Array<GeoPoint & { color?: string }>,
    color?: string
  ): void {
    mapInstance.value?.startFacilityBreathing(target, color)
  }

  function stopFacilityBreathing(): void {
    mapInstance.value?.stopFacilityBreathing()
  }

  function zoomToRegion(): void {
    const regionLevel = MAP_CONFIG.VIEW_LEVELS.REGION
    // 两个字段各管一个引擎：2D(OL) 用 zoom、3D(Cesium) 用 height。
    // 只传 height 时 OL 会按 heightToZoom 反推（1600km ⇒ z7.55），与 2D 区域默认
    // （OL 初始 OL_VIEW_ZOOM=9 = 本档 zoom）不一致——2026-10-04 实测踩到，故两字段都传。
    flyTo(regionLevel.center, { height: regionLevel.height, zoom: regionLevel.zoom })
  }

  return {
    flyTo,
    startBreathing,
    stopBreathing,
    startFacilityBreathing,
    stopFacilityBreathing,
    zoomToRegion,
    mapInstance,
  }
}
